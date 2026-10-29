const mysql = require("mysql2/promise");
const dotenv = require("dotenv").config();
const pool = mysql.createPool(
    {
      host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        connectionLimit: 10,
        waitForConnections: true,
        connectionTimeout: 60000,
        idleTimeout: 10000,
        queryTimeout: 60000,

    }
)
module.exports =pool;
