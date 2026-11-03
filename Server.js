require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const authRoutes = require("./routes/authRoutes.js")
const artisanRoutes = require("./routes/artisanRoute.js")
const categoryRoutes = require("./routes/Categoryroutes.js")
const portfolioRoutes = require("./routes/portfolioRoute.js")
const SearchRouter = require("./routes/searchRoutes.js")
app.use(cors());
 app.use(express.json());
 
app.use("/api/artisans", artisanRoutes);
app.use("/api/categories", categoryRoutes); 
app.use("/api/auth", authRoutes);
app.use("/api/portfolio", portfolioRoutes);
app.use("/api/artisans/search", SearchRouter);

const port = process.env.PORT || 5000;
 app.listen(port, ()=>{
    console.log(`Server is running on port ${process.env.PORT}`);
 })
  