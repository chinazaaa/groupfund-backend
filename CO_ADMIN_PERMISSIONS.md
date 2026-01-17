# Co-Admin Permissions

This document outlines what co-admins can and cannot do in GroupFund groups.

## Overview

Co-admins have limited administrative permissions designed to help manage groups while maintaining important safeguards. They can assist with day-to-day operations but cannot modify critical group settings.

---

## ✅ Co-Admins CAN Do

### Group Management
- **Update most group settings** including:
  - Group name
  - Notes
  - Deadlines (for general and subscription groups)
  - Accepting requests toggle
  - Chat enabled/disabled (for general groups)
  - Wishlist enabled/disabled (for general groups)
  - Public/private status (for subscription groups only)
  
  ⚠️ **Restrictions:** Cannot change contribution amount or max members

### Member Management
- **Approve or reject member join requests** - Can approve or reject pending members
- **Remove members** - Can remove regular members from the group
- **View all members** - Can see both active and pending members
- **Leave group freely** - No restrictions on leaving the group

### Contribution Management
- **Confirm contributions** - Can mark subscription and general contributions as confirmed (payment received)
- **Reject contributions** - Can mark subscription and general contributions as not received
- **Make contributions** - Can contribute like any regular member (not excluded from payment obligations)

### Personal Features
- **Add/manage personal bank accounts** - Can add, update, and delete their own bank accounts for personal withdrawals

---

## ❌ Co-Admins CANNOT Do

### Group Settings
- **Change contribution amount** - Only admins can modify this critical setting
- **Change max members** - Only admins can modify this setting (for birthday groups)

### Member Management
- **Promote/demote members** - Cannot change member roles (promote to co-admin or demote co-admin to member). Only admins can do this.
- **Remove admins** - Cannot remove other admins from the group
- **Remove other co-admins** - Cannot remove other co-admins, only regular members

### Group Lifecycle
- **Close groups** - Only the group creator or system admin can close groups
- **Reopen groups** - Only the group creator or system admin can reopen closed groups
- **Delete groups** - Only system admins can delete groups
- **Transfer admin role** - Cannot transfer admin ownership

### System Features
- **System admin functions** - Cannot access platform-wide admin features (user management, system statistics, etc.)

---

## Permission Summary Table

| Action | Co-Admin | Admin | Notes |
|--------|----------|-------|-------|
| Update group name | ✅ | ✅ | - |
| Update contribution amount | ❌ | ✅ | Critical setting |
| Update max members | ❌ | ✅ | Critical setting |
| Update deadlines | ✅ | ✅ | - |
| Update other settings | ✅ | ✅ | Notes, chat, wishlist, etc. |
| Approve/reject members | ✅ | ✅ | - |
| Remove regular members | ✅ | ✅ | - |
| Remove co-admins | ❌ | ✅ | Co-admins cannot remove other co-admins |
| Remove admins | ❌ | ❌ | No one can remove admins |
| Promote/demote members | ❌ | ✅ | Only admins can change roles |
| Confirm/reject contributions | ✅ | ✅ | - |
| Close group | ❌ | ✅* | *Only creator or system admin |
| Reopen group | ❌ | ✅* | *Only creator or system admin |
| Delete group | ❌ | ❌ | System admin only |
| Leave group | ✅ | ⚠️ | Admins can only leave if not the only admin |

---

## Notes

1. **Co-admins can leave groups freely** - Unlike admins, co-admins have no restrictions on leaving
2. **Bank accounts are personal** - Co-admins can manage their own bank accounts, but group manual payment displays only show the admin's bank account
3. **Progressive permissions** - Co-admins have more permissions than regular members but fewer than admins, creating a helpful middle tier for group management
4. **Role hierarchy**: Admin > Co-Admin > Member

---

## Implementation Details

Co-admin permissions are checked using the `checkGroupAdminPermissions()` helper function which returns:
```javascript
{
  isAdmin: boolean,
  isCoAdmin: boolean,
  isAdminOrCoAdmin: boolean,
  role: string
}
```

Routes check `isAdminOrCoAdmin` for most operations, with additional checks for `isAdmin` when co-admin restrictions apply.
