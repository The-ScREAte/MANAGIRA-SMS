require('dotenv').config(); // Load .env variables
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../config/db');

async function syncStripePrices() {
    try {
        if (!process.env.STRIPE_SECRET_KEY) {
            throw new Error("❌ Stripe Secret Key is missing. Check your .env file!");
        }

        const prices = await stripe.prices.list({ active: true });

        for (const price of prices.data) {
            const product = await stripe.products.retrieve(price.product);
            const planName = product.name.trim();


            await db.query(
                "UPDATE plans SET stripe_price_id = $1 WHERE plan_name ILIKE $2",
                [price.id, planName]
            );
        }

    } catch (error) {
        console.error("❌ Error syncing Stripe Prices:", error.message);
    }
}

syncStripePrices();
