"use strict";

// A call to an outside service that never answers must not hold a job's lock or a
// database connection for hours. Calls can still set their own timeout.
const axios = require("axios");

axios.defaults.timeout = Number(process.env.HTTP_TIMEOUT_MS) || 20000;
