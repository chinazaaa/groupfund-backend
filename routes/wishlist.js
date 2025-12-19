const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { CURRENCIES } = require('../utils/currency');
const { createNotification } = require('../utils/notifications');
const { formatAmount } = require('../utils/currency');

const router = express.Router();

// Get available currencies (for dropdown)
router.get('/currencies', authenticate, async (req, res) => {
  try {
    res.json({
      currencies: CURRENCIES,
      default: 'NGN',
    });
  } catch (error) {
    console.error('Get currencies error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all claims for a user's wishlist items (who claimed what) - Celebrant view
router.get('/:userId/claims', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;

    // Only the wishlist owner can view their claims
    if (currentUserId !== userId) {
      return res.status(403).json({ error: 'You can only view claims for your own wishlist' });
    }

    // Get all claims for user's wishlist items
    const claimsResult = await pool.query(
      `SELECT 
        wc.id as claim_id,
        wc.quantity_claimed,
        wc.created_at as claimed_at,
        wi.id as item_id,
        wi.name as item_name,
        wi.price,
        wi.currency,
        wi.is_done,
        u.id as claimed_by_user_id,
        u.name as claimed_by_user_name,
        u.email as claimed_by_user_email
       FROM wishlist_claims wc
       JOIN wishlist_items wi ON wc.wishlist_item_id = wi.id
       JOIN users u ON wc.claimed_by_user_id = u.id
       WHERE wi.user_id = $1
       ORDER BY wc.created_at DESC`,
      [userId]
    );

    res.json({
      user_id: userId,
      total_claims: claimsResult.rows.length,
      claims: claimsResult.rows,
    });
  } catch (error) {
    console.error('Get wishlist claims error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all items a user has claimed (Claimer view - see their own claims)
router.get('/my-claims', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get all items this user has claimed
    const claimsResult = await pool.query(
      `SELECT 
        wc.id as claim_id,
        wc.quantity_claimed,
        wc.created_at as claimed_at,
        wi.id as item_id,
        wi.name as item_name,
        wi.picture,
        wi.price,
        wi.currency,
        wi.quantity as item_total_quantity,
        wi.is_done as is_fulfilled,
        wi.created_at as item_created_at,
        wi.updated_at as item_updated_at,
        owner.id as owner_id,
        owner.name as owner_name,
        owner.email as owner_email,
        -- Calculate total claimed for this item
        (SELECT COALESCE(SUM(wc2.quantity_claimed), 0)
         FROM wishlist_claims wc2
         WHERE wc2.wishlist_item_id = wi.id) as total_claimed_for_item,
        -- Calculate remaining for this item
        (wi.quantity - COALESCE((SELECT SUM(wc2.quantity_claimed) FROM wishlist_claims wc2 WHERE wc2.wishlist_item_id = wi.id), 0)) as remaining_for_item
       FROM wishlist_claims wc
       JOIN wishlist_items wi ON wc.wishlist_item_id = wi.id
       JOIN users owner ON wi.user_id = owner.id
       WHERE wc.claimed_by_user_id = $1
       ORDER BY wc.created_at DESC`,
      [userId]
    );

    // Separate into fulfilled and pending
    const fulfilled = claimsResult.rows.filter(claim => claim.is_fulfilled);
    const pending = claimsResult.rows.filter(claim => !claim.is_fulfilled);

    res.json({
      user_id: userId,
      total_claims: claimsResult.rows.length,
      fulfilled_count: fulfilled.length,
      pending_count: pending.length,
      fulfilled: fulfilled,
      pending: pending,
      all_claims: claimsResult.rows,
    });
  } catch (error) {
    console.error('Get my claims error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

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
        id, name, quantity, picture, price, currency, is_done, created_at, updated_at
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
  body('currency').optional().isLength({ min: 3, max: 3 }).withMessage('Currency must be a 3-letter code'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { name, quantity = 1, picture, price, currency = 'NGN' } = req.body;

    const result = await pool.query(
      `INSERT INTO wishlist_items (user_id, name, quantity, picture, price, currency)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, quantity, picture, price, currency, is_done, created_at, updated_at`,
      [userId, name, quantity, picture || null, price || null, currency]
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
  body('currency').optional().isLength({ min: 3, max: 3 }).withMessage('Currency must be a 3-letter code'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { itemId } = req.params;
    const userId = req.user.id;
    const { name, quantity, picture, price, currency } = req.body;

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
    if (currency !== undefined) {
      updates.push(`currency = $${paramCount++}`);
      values.push(currency);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(itemId, userId);
    const query = `UPDATE wishlist_items 
                  SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP 
                  WHERE id = $${paramCount} AND user_id = $${paramCount + 1}
                  RETURNING id, name, quantity, picture, price, currency, is_done, created_at, updated_at`;

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
        wi.id, wi.name, wi.quantity, wi.picture, wi.price, wi.currency, wi.is_done,
        COALESCE(SUM(wc.quantity_claimed), 0) as total_claimed
       FROM wishlist_items wi
       LEFT JOIN wishlist_claims wc ON wi.id = wc.wishlist_item_id
       WHERE wi.id = $1
       GROUP BY wi.id, wi.name, wi.quantity, wi.picture, wi.price, wi.currency, wi.is_done`,
      [itemId]
    );

    const updatedItem = updatedItemResult.rows[0];
    const remainingAfterClaim = updatedItem.quantity - parseInt(updatedItem.total_claimed);

    // Get user names for notification
    const claimerResult = await pool.query(
      'SELECT name FROM users WHERE id = $1',
      [claimedByUserId]
    );
    const claimerName = claimerResult.rows[0]?.name || 'Someone';

    // Get shared groups to determine which group to associate with notification
    const sharedGroupResult = await pool.query(
      `SELECT g.id, g.name
       FROM groups g
       JOIN group_members gm1 ON g.id = gm1.group_id
       JOIN group_members gm2 ON g.id = gm2.group_id
       WHERE gm1.user_id = $1 AND gm2.user_id = $2
         AND gm1.status = 'active' AND gm2.status = 'active'
       LIMIT 1`,
      [claimedByUserId, item.owner_id]
    );

    const groupId = sharedGroupResult.rows[0]?.id || null;
    const groupName = sharedGroupResult.rows[0]?.name || 'your group';

    // Create notification for wishlist owner
    const quantityText = quantity === 1 ? 'item' : `${quantity} items`;
    const priceText = item.price 
      ? ` (${formatAmount(item.price, item.currency || 'NGN')})` 
      : '';
    
    await createNotification(
      item.owner_id,
      'wishlist_claim',
      'Wishlist Item Claimed',
      `${claimerName} claimed ${quantityText} of "${item.name}"${priceText} from your wishlist`,
      groupId,
      claimedByUserId
    );

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

    // Get claim details and item info before deleting
    const claimDetails = await pool.query(
      `SELECT wc.id, wc.quantity_claimed, wi.user_id as owner_id, wi.name as item_name
       FROM wishlist_claims wc
       JOIN wishlist_items wi ON wc.wishlist_item_id = wi.id
       WHERE wc.id = $1 AND wc.claimed_by_user_id = $2 AND wc.wishlist_item_id = $3`,
      [claimId, userId, itemId]
    );

    if (claimDetails.rows.length === 0) {
      return res.status(404).json({ error: 'Claim not found or you do not have permission to remove it' });
    }

    const claim = claimDetails.rows[0];
    const ownerId = claim.owner_id;
    const itemName = claim.item_name;
    const quantityClaimed = claim.quantity_claimed;

    // Get user name for notification
    const claimerResult = await pool.query(
      'SELECT name FROM users WHERE id = $1',
      [userId]
    );
    const claimerName = claimerResult.rows[0]?.name || 'Someone';

    // Get shared groups to determine which group to associate with notification
    const sharedGroupResult = await pool.query(
      `SELECT g.id, g.name
       FROM groups g
       JOIN group_members gm1 ON g.id = gm1.group_id
       JOIN group_members gm2 ON g.id = gm2.group_id
       WHERE gm1.user_id = $1 AND gm2.user_id = $2
         AND gm1.status = 'active' AND gm2.status = 'active'
       LIMIT 1`,
      [userId, ownerId]
    );

    const groupId = sharedGroupResult.rows[0]?.id || null;

    // Delete claim
    await pool.query('DELETE FROM wishlist_claims WHERE id = $1', [claimId]);

    // Create notification for wishlist owner
    const quantityText = quantityClaimed === 1 ? 'item' : `${quantityClaimed} items`;
    await createNotification(
      ownerId,
      'wishlist_unclaim',
      'Wishlist Item Unclaimed',
      `${claimerName} unclaimed ${quantityText} of "${itemName}" from your wishlist`,
      groupId,
      userId
    );

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

    // Get item details first
    const itemResult = await pool.query(
      `SELECT wi.*, u.name as owner_name
       FROM wishlist_items wi
       JOIN users u ON wi.user_id = u.id
       WHERE wi.id = $1 AND wi.user_id = $2`,
      [itemId, userId]
    );

    if (itemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Wishlist item not found or you do not have permission to update it' });
    }

    const item = itemResult.rows[0];
    const previousStatus = item.is_done;

    // Update item
    const result = await pool.query(
      `UPDATE wishlist_items 
       SET is_done = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 AND user_id = $3
       RETURNING id, name, quantity, picture, price, currency, is_done, created_at, updated_at`,
      [is_done, itemId, userId]
    );

    // If marking as done (fulfilled), notify all users who claimed this item
    if (is_done && !previousStatus) {
      // Get all claims for this item
      const claimsResult = await pool.query(
        `SELECT wc.claimed_by_user_id, wc.quantity_claimed, u.name as claimer_name
         FROM wishlist_claims wc
         JOIN users u ON wc.claimed_by_user_id = u.id
         WHERE wc.wishlist_item_id = $1`,
        [itemId]
      );

      // Notify each claimer
      for (const claim of claimsResult.rows) {
        const claimerId = claim.claimed_by_user_id;
        const quantityText = claim.quantity_claimed === 1 ? 'item' : `${claim.quantity_claimed} items`;
        
        // Get shared group for this specific claimer
        const claimerGroupResult = await pool.query(
          `SELECT DISTINCT g.id, g.name
           FROM groups g
           JOIN group_members gm1 ON g.id = gm1.group_id
           JOIN group_members gm2 ON g.id = gm2.group_id
           WHERE gm1.user_id = $1 AND gm2.user_id = $2
             AND gm1.status = 'active' AND gm2.status = 'active'
           LIMIT 1`,
          [userId, claimerId]
        );

        const groupId = claimerGroupResult.rows[0]?.id || null;
        const ownerName = item.owner_name || 'The celebrant';

        await createNotification(
          claimerId,
          'wishlist_fulfilled',
          'Wishlist Item Fulfilled',
          `${ownerName} marked "${item.name}" as fulfilled. Thank you for claiming ${quantityText}!`,
          groupId,
          userId
        );
      }
    }

    res.json({
      message: `Item marked as ${is_done ? 'fulfilled' : 'not fulfilled'} successfully`,
      item: result.rows[0],
    });
  } catch (error) {
    console.error('Mark wishlist item done error:', error);
    res.status(500).json({ error: 'Server error marking item as done' });
  }
});

module.exports = router;

