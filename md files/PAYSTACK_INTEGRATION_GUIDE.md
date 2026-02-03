# Paystack Payment & Subscription Integration - Complete Guide

## How It Works Now

### 1. Payment Flow
When a user makes a payment through your app:

1. **Payment Made**: User pays via Paystack Inline widget
2. **Card Authorization**: Paystack automatically creates an authorization code for the card
3. **Subscription Created**: A monthly subscription is created using the authorization
4. **Card Stored**: The authorization code and card details are saved to `stored_cards` table
5. **Automatic Billing**: Paystack will automatically charge the saved card monthly

### 2. Database Changes Required

**Run this SQL in your PostgreSQL database:**

```sql
-- Add Paystack fields to organizations table
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS paystack_customer_code VARCHAR(255);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan_id INT;

-- Update payments table for Paystack
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paystack_subscription_code VARCHAR(255);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paystack_reference VARCHAR(255);

-- Create stored_cards table for managing user cards
CREATE TABLE IF NOT EXISTS stored_cards (
    id SERIAL PRIMARY KEY,
    organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    authorization_code VARCHAR(255) NOT NULL,
    card_type VARCHAR(50),
    last4 VARCHAR(4),
    exp_month VARCHAR(2),
    exp_year VARCHAR(4),
    bin VARCHAR(6),
    bank VARCHAR(100),
    channel VARCHAR(50),
    signature VARCHAR(255),
    reusable BOOLEAN DEFAULT true,
    country_code VARCHAR(3),
    is_primary BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE UNIQUE INDEX IF NOT EXISTS idx_stored_cards_auth_code ON stored_cards(authorization_code);
CREATE INDEX IF NOT EXISTS idx_stored_cards_org_id ON stored_cards(organization_id);
CREATE INDEX IF NOT EXISTS idx_stored_cards_active ON stored_cards(organization_id, is_active);
```

### 3. How Paystack Subscriptions Work

**Yes, it's automatic!** Here's how:

1. **First Payment**: User pays manually via Paystack widget
2. **Card Saved**: Paystack creates an authorization code for future charges
3. **Subscription Active**: Monthly subscription is created with this authorization
4. **Auto-Billing**: Paystack automatically charges the card every month
5. **Webhooks**: Paystack sends notifications about successful/failed payments

### 4. Key Benefits

✅ **Automatic Payments**: No manual intervention needed  
✅ **Card Storage**: Cards are securely stored by Paystack  
✅ **Multiple Cards**: Users can have multiple saved cards  
✅ **Easy Management**: Built-in card management system  
✅ **Failed Payment Handling**: Paystack handles retry logic  

### 5. What Changed in Your Code

**Payment Controller (`accountController.js`)**:
- Now saves card authorization after successful payment
- Stores card details in `stored_cards` table
- Creates proper Paystack subscription with authorization
- Links customer, plan, and card together

**Card Management**:
- `updateCard.ejs` allows adding/removing cards
- `updateCardGet()` - Shows saved cards
- `addCardPost()` - Adds new cards
- `removeCardPost()` - Deactivates cards

### 6. Testing

**Test Card Numbers**:
```
Mastercard: 5399 8383 8383 8381
Visa: 4084 0840 8408 4081
Verve: 5061 4600 3606 1234
```

**Process**:
1. Register new organization
2. Pay with test card
3. Check database - card should be saved
4. Subscription should be active in Paystack dashboard

### 7. Important Notes

⚠️ **First Payment**: User pays manually during registration  
⚠️ **Subsequent Payments**: Paystack charges automatically monthly  
⚠️ **Card Updates**: Users can add/remove cards via update-card page  
⚠️ **Failed Payments**: Paystack will retry and send webhooks  

### 8. Next Steps

1. **Run the SQL commands** to update your database
2. **Test the payment flow** with test cards
3. **Set up webhooks** (optional) to handle payment notifications
4. **Monitor Paystack dashboard** for subscription status

The system now properly saves cards and handles automatic subscription billing through Paystack! 🎉
