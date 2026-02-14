# Hub Invitation System - Enhanced (New & Existing Organizations)

## Overview
Hubs can now invite both **new organizations** (not yet on Managira) and **existing organizations** (already using Managira) to join their hub.

---

## Features

### 1. Dual Invitation Types

When clicking "Invite Organization" on the hub dashboard, users see two options:

#### ✨ New Organization (Not on Managira yet)
- For organizations that don't have a Managira account
- They'll create a new account and automatically join your hub
- Original invitation system enhanced

#### 🏢 Existing Organization (Already have an account)
- For organizations already using Managira
- Search by organization name or email
- Send invitation to join your hub
- They accept with one click

---

## User Flow

### Hub Inviting New Organization

1. Click "+ Invite Organization" on dashboard
2. Select "✨ New Organization"
3. Fill in:
   - Organization name
   - Contact person name & email
   - Optional phone number
   - Optional personal message
4. Send invitation
5. Organization receives email with registration link
6. They complete registration form and automatically join hub

### Hub Inviting Existing Organization

1. Click "+ Invite Organization" on dashboard
2. Select "🏢 Existing Organization"
3. Type organization name or email in search box
4. Real-time search displays results:
   - Organization name
   - Email address
   - Current subdomain (nickname.managira.com)
   - Warning badge if already in a hub
5. Click "Select" button on desired organization
6. Confirm invitation
7. Organization receives email invitation
8. They click "Accept Invitation" link
9. Review changes and confirm
10. Automatically joined to hub

---

## Search Functionality

### Search API: `GET /hub/organizations/search?q=query`

**Features:**
- Real-time search as you type (300ms debounce)
- Searches organization name and email
- Minimum 2 characters required
- Returns up to 10 results
- Shows only organizations not already in your hub
- Highlights organizations already in other hubs (disabled)

**Response:**
```json
{
  "organizations": [
    {
      "organization_id": 123,
      "organization_name": "Example School",
      "email": "admin@example.com",
      "nickname": "example",
      "is_hub_member": false,
      "hub_id": null
    }
  ]
}
```

**UI Display:**
- Organization card with name, email, subdomain
- "Already in a hub" warning badge if applicable
- "Select" button (disabled if in another hub)
- Hover effect with border color change

---

## Database Changes

### New Column: `hub_organization_invitations.existing_org_id`
```sql
ALTER TABLE hub_organization_invitations 
ADD COLUMN existing_org_id INTEGER REFERENCES organizations(organization_id) ON DELETE CASCADE;

CREATE INDEX idx_hub_invitations_existing_org ON hub_organization_invitations(existing_org_id);
```

**Purpose:** Links invitation to an existing organization ID when inviting existing orgs

---

## Routes

### Hub Routes (hubRoute.js)
```javascript
GET  /hub/organizations/search                 // Search existing organizations
POST /hub/organizations/invite-existing        // Send invite to existing org
```

### Account Routes (accountRoute.js)
```javascript
GET  /account/accept-hub-invitation-existing/:token    // View invitation acceptance page
POST /account/accept-hub-invitation-existing/:token    // Process invitation acceptance
```

---

## Controllers

### hubController.js

#### `searchOrganizationsGet`
- Searches organizations by name or email
- Excludes organizations already in the hub
- Returns JSON with organization details
- Includes hub membership status

#### `inviteExistingOrgPost`
- Validates organization exists and is not in a hub
- Checks for existing pending invitations
- Verifies hub capacity
- Creates invitation record with existing_org_id
- Generates invitation token (7-day expiry)
- Sends invitation email
- Logs activity

---

### accountController.js

#### `hubInvitationAcceptExistingGet`
- Validates invitation token
- Checks invitation not expired
- Renders acceptance page with invitation details
- Shows changes that will occur

#### `hubInvitationAcceptExistingPost`
- Uses database transaction for atomicity
- Validates organization not already in a hub
- Updates organization:
  - Sets hub_id
  - Sets is_hub_member = true
  - Sets joined_hub_at timestamp
- Updates invitation status to 'accepted'
- Logs activity
- Sends confirmation emails to both hub and organization
- Redirects to login page

---

## Email Templates

### 1. Invitation to Existing Organization
**Subject:** "Invitation to join [Hub Name] Hub - Managira SMS"

**Content:**
- Hub name and invitation details
- "What is a Hub?" explanation
- Important changes warning:
  - New subdomain: nickname.hub_nickname.managira.com
  - Subscription managed by hub
  - Data remains intact
  - Full operational control retained
- "Accept Invitation" button
- Expiry date
- Hub contact information

---

### 2. Confirmation to Hub (After Acceptance)
**Subject:** "[Org Name] Joined Your Hub"

**Content:**
- Success notification
- Organization details (name, email, new subdomain)
- Link to hub dashboard
- Management instructions

---

### 3. Confirmation to Organization (After Acceptance)
**Subject:** "Welcome to [Hub Name] Hub"

**Content:**
- Welcome message
- Confirmation of hub membership
- Important changes recap:
  - New subdomain
  - Subscription management
  - Data integrity
  - Operational control
- Login instructions (use existing credentials)
- Hub contact information

---

## UI Components

### Invitation Type Selection Page

**Layout:** 2-column grid with gradient cards

**New Organization Card:**
- Gradient: Teal (#01535b → #6fd3c4)
- Icon: ✨
- Title: "New Organization"
- Subtitle: "Not on Managira yet"
- Description: Create new account and join
- Hover effect: translateY(-4px) with enhanced shadow

**Existing Organization Card:**
- Gradient: Orange (#ff6b00 → #ff8c00)
- Icon: 🏢
- Title: "Existing Organization"
- Subtitle: "Already have a Managira account"
- Description: Search and invite existing organization
- Hover effect: translateY(-4px) with enhanced shadow

---

### Search Interface

**Search Input:**
- Real-time search with 300ms debounce
- Placeholder: "Type to search..."
- Helper text: "Search by organization name or email"

**States:**
1. **Initial:** Shows search instructions with 🔍 icon
2. **Searching:** (Handled by debounce)
3. **Results Found:** Displays organization cards
4. **No Results:** Shows "No organizations found" message

**Result Card:**
- Organization name (large, bold)
- Email with 📧 icon
- Subdomain with 🌐 icon
- Warning badge if in another hub: "⚠️ Already in a hub"
- "Select" button (green on hover, disabled if in hub)
- Hover effect: border color changes to primary

---

### Acceptance Page (Existing Organizations)

**Header:**
- Gradient background (teal)
- Title: "🤝 Hub Invitation"
- Subtitle: "You've been invited to join a hub!"

**Sections:**

1. **Invitation Details** (Blue info box)
   - Hub name
   - Your organization name
   - Invited by (hub email)
   - Expiration date

2. **Important Changes** (Yellow warning box)
   - Subdomain change with monospace font
   - Subscription management change
   - Hub membership notification
   - Centralized management note

3. **What Stays the Same** (Green success box)
   - Data integrity
   - Login credentials
   - Operational control
   - Team and permissions

4. **Confirmation Checkbox**
   - Required to enable submit button
   - Gray background box
   - Label: "I understand the changes above and want to join [Hub Name] hub"

5. **Action Buttons**
   - "✓ Accept & Join Hub" (primary, disabled until checkbox)
   - "Decline" (secondary, redirects to login)

6. **Footer**
   - Hub contact information
   - Smaller gray text

---

## Security & Validation

### Search Endpoint
- ✅ Requires hub authentication
- ✅ Only searches organizations not in requesting hub
- ✅ Maximum 10 results
- ✅ Case-insensitive search
- ✅ Excludes deleted organizations

### Invitation Creation
- ✅ Validates organization exists
- ✅ Checks not already in a hub
- ✅ Prevents duplicate invitations
- ✅ Verifies hub capacity
- ✅ Generates secure token (32-byte hex)
- ✅ Sets 7-day expiration

### Invitation Acceptance
- ✅ Uses database transaction (all-or-nothing)
- ✅ Validates token and expiration
- ✅ Confirms organization not in another hub
- ✅ Requires explicit confirmation checkbox
- ✅ Logs all actions
- ✅ Sends confirmation emails

---

## Activity Logging

All invitation actions are logged to `hub_activity_logs`:

### Action Types:
- `invitation_sent` - Invitation sent to existing organization
- `organization_joined` - Existing organization accepted invitation

### Log Entry Includes:
- hub_id
- target_organization_id
- action_type
- description (with organization name)
- performed_by (email)
- IP address
- timestamp

---

## Error Handling

### Common Errors:

**"Organization not found"**
- Organization doesn't exist or was deleted

**"Organization is already part of a hub"**
- Target organization already in another hub
- Cannot invite organizations already in hubs

**"An invitation has already been sent"**
- Pending invitation exists
- Prevents duplicate invitations

**"Maximum organization capacity reached"**
- Hub has reached max_organizations limit
- Cannot send more invitations

**"Invalid or expired invitation"**
- Token not found, already used, or past expiration
- Redirects to login with error message

**"Search failed"**
- Database or server error during search
- Shows error in search results area

---

## Transaction Handling

### Invitation Acceptance (Existing Orgs)

**Transaction Steps:**
1. BEGIN
2. Fetch and validate invitation
3. Verify organization eligibility
4. Update organization (hub_id, is_hub_member, joined_hub_at)
5. Update invitation status
6. Log activity
7. COMMIT

**On Error:**
- ROLLBACK all changes
- Release database client
- Flash error message
- Redirect to login

**Ensures:**
- Organization fully joins or doesn't join at all
- No partial updates
- Consistent database state
- Invitation marked as accepted only if successful

---

## User Experience

### For Hub Administrators:

**Benefits:**
- Clear choice between new and existing organizations
- Visual distinction with gradient cards
- Real-time search for quick discovery
- One-click invitation sending
- Clear capacity tracking
- Activity logging for audit trail

**Workflow:**
1. Click "+ Invite Organization" (2 seconds)
2. Choose invitation type (2 seconds)
3. Search/fill form (10-30 seconds)
4. Send invitation (1 click)
5. Receive confirmation

**Total Time:** ~15-35 seconds

---

### For Organizations (Existing):

**Benefits:**
- Clear explanation of changes
- Visual separation of what changes vs. what stays
- No data entry required (one-click acceptance)
- Existing credentials work
- Immediate access after acceptance

**Workflow:**
1. Receive email invitation
2. Click "Accept Invitation" link
3. Review changes on acceptance page (30-60 seconds)
4. Check confirmation checkbox
5. Click "Accept & Join Hub"
6. Redirect to login

**Total Time:** ~1-2 minutes

---

## Testing Checklist

### Hub Invitation Flow:
- [ ] Type selection page displays both options
- [ ] Both cards have hover effects
- [ ] New org form shows correctly
- [ ] Existing org search displays correctly
- [ ] Back buttons work from both forms
- [ ] Cancel buttons redirect to dashboard

### Search Functionality:
- [ ] Search requires 2+ characters
- [ ] Results display in real-time
- [ ] Organization details accurate
- [ ] Hub membership badge shows correctly
- [ ] Select button disabled for orgs in hubs
- [ ] No results message displays when appropriate
- [ ] Search works with both name and email

### Invitation Creation:
- [ ] Cannot invite organization in another hub
- [ ] Cannot send duplicate invitations
- [ ] Capacity check prevents over-invitation
- [ ] Email sent successfully
- [ ] Activity logged
- [ ] Success flash message displayed
- [ ] Redirects to dashboard

### Invitation Acceptance:
- [ ] Acceptance page loads with correct details
- [ ] Warning and benefits boxes display
- [ ] Submit button disabled until checkbox
- [ ] Transaction rolls back on error
- [ ] Organization updated correctly
- [ ] Invitation marked as accepted
- [ ] Emails sent to both parties
- [ ] Activity logged
- [ ] Redirects to login with success message

### Edge Cases:
- [ ] Expired invitation token handled
- [ ] Invalid token handled
- [ ] Organization deleted before acceptance
- [ ] Organization joins another hub before acceptance
- [ ] Network errors during search
- [ ] Database errors handled gracefully

---

## Comparison: New vs. Existing Organization Invitations

| Feature | New Organization | Existing Organization |
|---------|------------------|----------------------|
| **Account Creation** | Required | Not required |
| **Data Entry** | Full registration form | None (uses existing data) |
| **Subdomain** | New: nickname.hub_nickname.managira.com | Changes: nickname.hub_nickname.managira.com |
| **Subscription** | Starts with hub | Transfers to hub |
| **Email Template** | Registration invitation | Join invitation |
| **Acceptance Page** | Registration form | Confirmation page |
| **Time to Join** | ~5-10 minutes | ~1-2 minutes |
| **Database Records** | Creates organization + user | Updates existing organization |
| **Risk** | Higher (new account setup) | Lower (existing account) |

---

## Future Enhancements

### Possible Additions:
1. **Bulk Invitations:** Upload CSV of organizations to invite
2. **Invitation Templates:** Custom messages saved as templates
3. **Auto-Search:** Suggest organizations based on hub profile
4. **Invitation History:** View all sent invitations (accepted/rejected/expired)
5. **Custom Expiry:** Allow hub to set invitation expiration date
6. **Invitation Reminders:** Auto-resend after X days
7. **Preview Changes:** Show organization what will change before accepting
8. **Transfer Wizard:** Guide existing orgs through migration process
9. **Batch Acceptance:** Allow orgs to accept multiple hub invitations at once
10. **Decline Reason:** Capture why organizations decline invitations

---

## Implementation Complete ✅

All components of the enhanced hub invitation system are fully implemented:
- ✅ Dual invitation type selection UI
- ✅ Search functionality for existing organizations
- ✅ Real-time search with debounce
- ✅ Invitation creation for existing orgs
- ✅ Acceptance page for existing orgs
- ✅ Transaction-based acceptance process
- ✅ Email notifications (3 templates)
- ✅ Database column added (existing_org_id)
- ✅ Activity logging
- ✅ Routes registered
- ✅ Security & validation
- ✅ Error handling

The system provides a seamless experience for inviting both new and existing organizations to join a hub.
