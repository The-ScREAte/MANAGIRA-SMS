# 🚀 Paystack Migration for Public Registration - Implementation Guide

## Overview
This migration replaces the Flutterwave subaccount system with Paystack for public registration payments. Organizations can now set up Paystack subaccounts to receive registration payments with automatic splits.

## ✅ Completed Changes

### 1. Database Schema
**File Created:** `/database/paystack_subaccounts_migration.sql`
- New `paystack_subaccounts` table to replace `flutterwave_accounts`
- New `public_registration_payments` table for payment tracking
- Proper indexes and constraints for performance

### 2. Frontend Updates
**File Modified:** `/views/account/updateCard.ejs`
- Replaced Flutterwave form with Paystack subaccount form
- Updated CSS classes from `flutterwave-*` to `paystack-*`
- New JavaScript handlers for Paystack subaccount management
- Form fields adapted for Paystack requirements (business_name, bank_code, percentage_charge)

### 3. Backend Controller Updates
**File Modified:** `/controllers/accountController.js`
- New `addPaystackSubaccountPost()` - Creates Paystack subaccounts via API
- New `deletePaystackSubaccount()` - Deletes subaccounts
- New `getPaystackSubaccountById()` - Fetches subaccount details for editing
- New `updatePaystackSubaccount()` - Updates subaccount information
- New `setPaystackSubaccountPrimary()` - Sets primary subaccount
- Updated `updateCardGet()` to fetch and display Paystack subaccounts

**File Modified:** `/controllers/commonController.js`
- Updated `publicRegisterStudentGet()` to use Paystack subaccounts
- Completely rewrote `initializePayment()` for Paystack API
- Payment tracking with proper reference generation

### 4. Routes
**File Modified:** `/routes/accountRoute.js`
- Added routes for all Paystack subaccount operations:
  - `POST /account/add-paystack-subaccount`
  - `GET /account/paystack/:id`
  - `PUT /account/paystack`
  - `DELETE /account/paystack/:id`
  - `POST /account/paystack/set-primary`

## 🔧 Manual Steps Required

### 1. Database Migration
Run the SQL migration script:
```sql
-- Execute the contents of /database/paystack_subaccounts_migration.sql
```

### 2. Frontend Template Updates

**Update:** `/views/common/publicRegisterStudent.ejs`

Replace the payment method selection:
```html
<!-- OLD Flutterwave -->
<select id="orgPaymentMethod" name="orgPaymentMethod" required>
  <option value="">-- Choose Payment Account --</option>
  <% flutterwaveAccounts.forEach(account => { %>
    <option value="<%= account.id %>">
      <%= account.account_type.toUpperCase() %> - <%= account.account_name %> - <%= account.account_number %>
    </option>
  <% }) %>
</select>

<!-- NEW Paystack -->
<select id="orgPaymentMethod" name="orgPaymentMethod" required>
  <option value="">-- Choose Payment Account --</option>
  <% paystackSubaccounts.forEach(account => { %>
    <option value="<%= account.subaccount_code %>">
      <%= account.account_type.toUpperCase() %> - <%= account.business_name %> - <%= account.account_number %>
    </option>
  <% }) %>
</select>
```

Update the payment initialization JavaScript:
```javascript
// Replace the fetch call in submitForm()
const paymentRes = await fetch('/common/initializePayment', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    subaccountCode: paymentMethodId, // Changed from subaccountId
    amount: '<%= orgDetails.public_registration_price || 0 %>'
  })
});

const paymentData = await paymentRes.json();
if (paymentData.success) {
  // Redirect to Paystack payment page
  window.location.href = paymentData.payment_url;
} else {
  alert('Payment initialization failed: ' + paymentData.error);
}
```

### 3. Payment Callback Handler

**Update:** `/controllers/commonController.js` - `paymentCallback` method
```javascript
paymentCallback: async (req, res, db) => {
  const reference = req.query.reference;
  const pendingStudentId = req.query.pendingStudentId;

  if (!reference) {
    req.flash("error", "Invalid payment reference");
    return res.redirect("/");
  }

  try {
    // Verify payment with Paystack
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );

    const paymentData = response.data.data;

    if (paymentData.status === 'success') {
      // Update payment status
      await db.query(
        `UPDATE public_registration_payments 
         SET status = 'completed', updated_at = NOW() 
         WHERE paystack_reference = $1`,
        [reference]
      );

      // Process student registration (existing logic)
      // ... rest of the success logic

      req.flash("success", "Payment successful! Registration completed.");
      res.redirect("/common/registrationSuccess");
    } else {
      throw new Error("Payment verification failed");
    }
  } catch (error) {
    console.error("❌ Payment verification error:", error);
    req.flash("error", "Payment verification failed");
    res.redirect("/common/registrationFailed");
  }
}
```

### 4. Environment Variables
Ensure these are set in your `.env` file:
```env
PAYSTACK_SECRET_KEY=sk_test_your_secret_key
PAYSTACK_PUBLIC_KEY=pk_test_your_public_key
```

## 🎯 Key Features

### For Organizations:
1. **Subaccount Management**: Create bank or mobile money subaccounts
2. **Commission Settings**: Set percentage splits for payments
3. **Primary Account Selection**: Choose which account receives payments
4. **Easy Editing**: Modify subaccount details anytime

### For Public Registration:
1. **Card-Only Payments**: Secure card transactions via Paystack
2. **Automatic Splits**: Money goes directly to organization's subaccount
3. **Payment Tracking**: Full audit trail of all transactions
4. **Webhook Support**: Ready for payment status updates

## 🔄 Migration Steps from Flutterwave

1. **Run database migration** to create new tables
2. **Update frontend templates** as shown above
3. **Test subaccount creation** on the update card page
4. **Test public registration flow** with new payment system
5. **Optional**: Create migration script to convert existing Flutterwave accounts to Paystack

## 🚨 Important Notes

1. **Bank Codes**: Use Paystack's bank codes (e.g., 001 for GCB, 002 for Ecobank)
2. **Currency**: Defaults to GHS, amounts automatically converted to pesewas
3. **Channels**: Currently restricted to cards only, can be expanded
4. **Testing**: Use Paystack test keys for development
5. **Webhooks**: Consider implementing Paystack webhooks for real-time updates

## 🎉 Benefits

1. **Better User Experience**: Cleaner payment flow with cards
2. **Automatic Splits**: Direct payments to organization accounts
3. **Lower Fees**: Potentially better rates than Flutterwave
4. **Ghana Focus**: Optimized for Ghanaian banking system
5. **Modern API**: More robust and well-documented API

This migration maintains all existing functionality while upgrading to a more modern and efficient payment system!
