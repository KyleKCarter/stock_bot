require('dotenv').config();
const express = require('express');
const cors = require('cors');
const massive = require('massive');
const session = require('express-session');

const app = express();

const {
    SERVER_PORT,
    SESSION_SECRET,
    CONNECTION_STRING
} = process.env;

console.log(SERVER_PORT)

//Controllers
const sellAllPositions = require('./controllers/sellAllPositions');
// const headlineImpactStockBot = require('./controllers/headlineImpactStockBot');

// Massive
// massive(CONNECTION_STRING)
//     .then(dbInstance => {
//         app.set('database', dbInstance);
//         console.log('Database Connected');
//     })
//     .catch(error => console.log(error))

app.use(express.json());
app.use(cors());


// ENDPOINTS
app.post('/api/sell-all-positions', sellAllPositions.sellAllPositions);
app.post('/api/sell-position', sellAllPositions.sellPosition);

app.listen(SERVER_PORT, () => { console.log(`Running on ${SERVER_PORT}`)});