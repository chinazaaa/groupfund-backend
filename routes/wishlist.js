const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Get wishlist for a user (visible to group members)
router.get('/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;

    // Check if current user is in any shared groups with the wishlist owner
    const sharedGroupsCheck = await pool.query(
      `SELECT DISTINCT g.id
       FROM groups g
       JOIN group_members gm1 ON g.id = gm1.group_id
       JOIN group_members gm2 ON g.id = gm2.group_id
       WHERE gm1.user_id = $1 AND gm2.user_id = $2
         AND gm1.status = 'active' AND gm2.status = 'active'`,
      [currentUserId, userId]
    );

    // If viewing own wishlist, allow it
    // Otherwise, only allow if they share at least one active group
    if (currentUserId !== userId && sharedGroupsCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You can only view wishlists of users in your groups' });
    }

    // Get wishlist items for the user
    const itemsResult = await pool.query(
      `SELECT 
        id, name, quantity, picture, price, is_done, created_at, updated_at
       FROM wishlist_items
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    // Get claims for each item
    const itemsWithClaims = await Promise.all(
      itemsResult.rows.map(async (item) => {
        const claimsResult = await pool.query(
          `SELECT 
            wc.id as claim_id,
            wc.quantity_claimed,
            wc.created_at as claimed_at,
            u.id as claimed_by_user_id,
            u.name as claimed_by_user_name
           FROM wishlist_claims wc
           JOIN users u ON wc.claimed_by_user_id = u.id
           WHERE wc.wishlist_item_id = $1`,
          [item.id]
        );

        const totalClaimed = claimsResult.rows.reduce(
          (sum, claim) => sum + claim.quantity_claimed,
          0
        );
        const remaining = Math.max(0, item.quantity - totalClaimed);

        return {
          ...item,
          claims: claimsResult.rows,
          total_claimed: totalClaimed,
          remaining: remaining,
          is_available: remaining > 0 && !item.is_done,
        };
      })
    );

    res.json({
      user_id: userId,
      items: itemsWithClaims,
    });
  } catch (error) {
    console.error('Get wishlist error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add item to own wishlist
router.post('/', authenticate, [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('quantity').optional().isInt({ min: 1 }).withMessage('Quantity must be a positive integer'),
  body('picture').optional().custom((value) => {
    if (value === null || value === undefined || value === '') return true;
    // If provided, must be a valid URL
    const urlPattern = /^https?:\/\/.+/i;
    return urlPattern.test(value) || 'Picture must be a valid URL';
  }),
  body('price').optional().isFloat({ min: 0 }).withMessage('Price must be a positive number'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { name, quantity = 1, picture, price } = req.body;

    const result = await pool.query(
      `INSERT INTO wishlist_items (user_id, name, quantity, picture, price)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, quantity, picture, price, is_done, created_at, updated_at`,
      [userId, name, quantity, picture || null, price || null]
    );

    res.status(201).json({
      message: 'Wishlist item added successfully',
      item: result.rows[0],
    });
  } catch (error) {
    console.error('Add wishlist item error:', error);
    res.status(500).json({ error: 'Server error adding wishlist item' });
  }
});

// Update item in own wishlist
router.put('/:itemId', authenticate, [
  body('name').optional().trim().notEmpty(),
  body('quantity').optional().isInt({ min: 1 }),
  body('picture').optional().custom((value) => {
    if (value === null || value === undefined || value === '') return true;
    // If provided, must be a valid URL
    const urlPattern = /^https?:\/\/.+/i;
    return urlPattern.test(value) || 'Picture must be a valid URL';
  }),
  body('price').optional().isFloat({ min: 0 }),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { itemId } = req.params;
    const userId = req.user.id;
    const { name, quantity, picture, price } = req.body;

    // Check if item belongs to user
    const itemCheck = await pool.query(
      'SELECT id FROM wishlist_items WHERE id = $1 AND user_id = $2',
      [itemId, userId]
    );

    if (itemCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Wishlist item not found or you do not have permission to update it' });
    }

    // Build update query
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (quantity !== undefined) {
      updates.push(`quantity = $${paramCount++}`);
      values.push(quantity);
    }
    if (picture !== undefined) {
      updates.push(`picture = $${paramCount++}`);
      values.push(picture || null);
    }
    if (price !== undefined) {
      updates.push(`price = $${paramCount++}`);
      values.push(price || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(itemId, userId);
    const query = `UPDATE wishlist_items 
                  SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP 
                  WHERE id = $${paramCount} AND user_id = $${paramCount + 1}
                  RETURNING id, name, quantity, picture, price, is_done, created_at, updated_at`;

    const result = await pool.query(query, values);

    res.json({
      message: 'Wishlist item updated successfully',
      item: result.rows[0],
    });
  } catch (error) {
    console.error('Update wishlist item error:', error);
    res.status(500).json({ error: 'Server error updating wishlist item' });
  }
});

// Remove item from own wishlist
router.delete('/:itemId', authenticate, async (req, res) => {
  try {
    const { itemId } = req.params;
    const userId = req.user.id;

    // Check if item belongs to user
    const itemCheck = await pool.query(
      'SELECT id FROM wishlist_items WHERE id = $1 AND user_id = $2',
      [itemId, userId]
    );

    if (itemCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Wishlist item not found or you do not have permission to delete it' });
    }

    // Delete item (cascade will delete claims)
    await pool.query('DELETE FROM wishlist_items WHERE id = $1', [itemId]);

    res.json({ message: 'Wishlist item removed successfully' });
  } catch (error) {
    console.error('Delete wishlist item error:', error);
    res.status(500).json({ error: 'Server error deleting wishlist item' });
  }
});

// Claim an item (mark as taken)
router.post('/:itemId/claim', authenticate, [
  body('quantity').optional().isInt({ min: 1 }).withMessage('Quantity must be a positive integer'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { itemId } = req.params;
    const claimedByUserId = req.user.id;
    const { quantity = 1 } = req.body;

    // Get item details
    const itemResult = await pool.query(
      `SELECT wi.*, u.id as owner_id
       FROM wishlist_items wi
       JOIN users u ON wi.user_id = u.id
       WHERE wi.id = $1`,
      [itemId]
    );

    if (itemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Wishlist item not found' });
    }

    const item = itemResult.rows[0];

    // Check if user is in a shared group with the item owner
    const sharedGroupsCheck = await pool.query(
      `SELECT DISTINCT g.id
       FROM groups g
       JOIN group_members gm1 ON g.id = gm1.group_id
       JOIN group_members gm2 ON g.id = gm2.group_id
       WHERE gm1.user_id = $1 AND gm2.user_id = $2
         AND gm1.status = 'active' AND gm2.status = 'active'`,
      [claimedByUserId, item.owner_id]
    );

    if (sharedGroupsCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You can only claim items from users in your groups' });
    }

    // Check if item is done
    if (item.is_done) {
      return res.status(400).json({ error: 'This item has been marked as done' });
    }

    // Get current claims
    const claimsResult = await pool.query(
      `SELECT SUM(quantity_claimed) as total_claimed
       FROM wishlist_claims
       WHERE wishlist_item_id = $1`,
      [itemId]
    );

    const totalClaimed = parseInt(claimsResult.rows[0]?.total_claimed || 0);
    const remaining = item.quantity - totalClaimed;

    if (quantity > remaining) {
      return res.status(400).json({ 
        error: `Only ${remaining} item(s) remaining. Cannot claim ${quantity}.` 
      });
    }

    // Check if user already claimed this item
    const existingClaim = await pool.query(
      'SELECT id, quantity_claimed FROM wishlist_claims WHERE wishlist_item_id = $1 AND claimed_by_user_id = $2',
      [itemId, claimedByUserId]
    );

    if (existingClaim.rows.length > 0) {
      // Update existing claim
      const newQuantity = existingClaim.rows[0].quantity_claimed + quantity;
      if (newQuantity > item.quantity) {
        return res.status(400).json({ 
          error: `You have already claimed ${existingClaim.rows[0].quantity_claimed} item(s). Total cannot exceed ${item.quantity}.` 
        });
      }

      await pool.query(
        'UPDATE wishlist_claims SET quantity_claimed = $1 WHERE id = $2',
        [newQuantity, existingClaim.rows[0].id]
      );
    } else {
      // Create new claim
      await pool.query(
        `INSERT INTO wishlist_claims (wishlist_item_id, claimed_by_user_id, quantity_claimed)
         VALUES ($1, $2, $3)`,
        [itemId, claimedByUserId, quantity]
      );
    }

    // Get updated item with claims
    const updatedItemResult = await pool.query(
      `SELECT 
        wi.id, wi.name, wi.quantity, wi.picture, wi.price, wi.is_done,
        COALESCE(SUM(wc.quantity_claimed), 0) as total_claimed
       FROM wishlist_items wi
       LEFT JOIN wishlist_claims wc ON wi.id = wc.wishlist_item_id
       WHERE wi.id = $1
       GROUP BY wi.id, wi.name, wi.quantity, wi.picture, wi.price, wi.is_done`,
      [itemId]
    );

    const updatedItem = updatedItemResult.rows[0];
    const remainingAfterClaim = updatedItem.quantity - parseInt(updatedItem.total_claimed);

    res.json({
      message: 'Item claimed successfully',
      item: {
        ...updatedItem,
        total_claimed: parseInt(updatedItem.total_claimed),
        remaining: remainingAfterClaim,
      },
    });
  } catch (error) {
    console.error('Claim wishlist item error:', error);
    res.status(500).json({ error: 'Server error claiming wishlist item' });
  }
});

// Unclaim an item
router.delete('/:itemId/claim/:claimId', authenticate, async (req, res) => {
  try {
    const { itemId, claimId } = req.params;
    const userId = req.user.id;

    // Check if claim belongs to user
    const claimCheck = await pool.query(
      'SELECT id FROM wishlist_claims WHERE id = $1 AND claimed_by_user_id = $2 AND wishlist_item_id = $3',
      [claimId, userId, itemId]
    );

    if (claimCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Claim not found or you do not have permission to remove it' });
    }

    // Delete claim
    await pool.query('DELETE FROM wishlist_claims WHERE id = $1', [claimId]);

    res.json({ message: 'Claim removed successfully' });
  } catch (error) {
    console.error('Unclaim wishlist item error:', error);
    res.status(500).json({ error: 'Server error removing claim' });
  }
});

// Mark item as done (celebrant only)
router.put('/:itemId/mark-done', authenticate, [
  body('is_done').isBoolean().withMessage('is_done must be a boolean'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { itemId } = req.params;
    const userId = req.user.id;
    const { is_done } = req.body;

    // Check if item belongs to user
    const itemCheck = await pool.query(
      'SELECT id FROM wishlist_items WHERE id = $1 AND user_id = $2',
      [itemId, userId]
    );

    if (itemCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Wishlist item not found or you do not have permission to update it' });
    }

    // Update item
    const result = await pool.query(
      `UPDATE wishlist_items 
       SET is_done = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 AND user_id = $3
       RETURNING id, name, quantity, picture, price, is_done, created_at, updated_at`,
      [is_done, itemId, userId]
    );

    res.json({
      message: `Item marked as ${is_done ? 'done' : 'not done'} successfully`,
      item: result.rows[0],
    });
  } catch (error) {
    console.error('Mark wishlist item done error:', error);
    res.status(500).json({ error: 'Server error marking item as done' });
  }
});

module.exports = router;

