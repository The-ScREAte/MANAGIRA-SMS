const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

module.exports = (passport) => {
    // Hub Local Strategy
    passport.use('hub-local', new LocalStrategy({
        usernameField: 'email',
        passwordField: 'password'
    }, async (email, password, done) => {
        try {
            const result = await pool.query(
                'SELECT * FROM managira_hubs WHERE hub_email = $1 AND deleted = false', 
                [email]
            );
            const hub = result.rows[0];

            if (!hub) {
                return done(null, false, { message: 'Incorrect email or password.' });
            }

            // Check if hub is on hold
            if (hub.on_hold) {
                return done(null, false, { message: 'Your hub account is currently on hold. Please contact support.' });
            }

            // Check if password is set (for first-time setup)
            if (!hub.hub_password) {
                return done(null, false, { message: 'Please complete your password setup first.' });
            }

            const isMatch = await bcrypt.compare(password, hub.hub_password);
            if (!isMatch) {
                return done(null, false, { message: 'Incorrect email or password.' });
            }

            return done(null, hub);
        } catch (err) {
            console.error('Hub authentication error:', err);
            return done(err);
        }
    }));

    // Serialize hub user
    passport.serializeUser((entity, done) => {
        // Check if it's a hub or regular user
        if (entity.hub_id) {
            done(null, { type: 'hub', id: entity.hub_id });
        } else if (entity.user_id) {
            done(null, { type: 'user', id: entity.user_id });
        } else {
            done(new Error('Unknown entity type'));
        }
    });

    // Deserialize hub user
    passport.deserializeUser(async (obj, done) => {
        try {
            if (obj.type === 'hub') {
                const result = await pool.query(
                    'SELECT * FROM managira_hubs WHERE hub_id = $1', 
                    [obj.id]
                );
                const hub = result.rows[0];
                done(null, hub);
            } else if (obj.type === 'user') {
                const result = await pool.query(
                    'SELECT * FROM users WHERE user_id = $1', 
                    [obj.id]
                );
                const user = result.rows[0];
                done(null, user);
            }
        } catch (err) {
            done(err);
        }
    });
};
