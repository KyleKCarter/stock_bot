const axios = require('axios');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const IBKR_GATEWAY = process.env.IBKR_GATEWAY || 'https://localhost:5000/v1/api';
const TOKEN_PATH = path.join(__dirname, 'ibkr_token.json');
const PRIVATE_KEY_PATH = process.env.IBKR_PRIVATE_KEY_PATH || path.join(__dirname, 'private.pem');
const CLIENT_ID = process.env.IBKR_CLIENT_ID;
const TOKEN_ENDPOINT = process.env.IBKR_TOKEN_ENDPOINT; // e.g. 'https://auth.interactivebrokers.com/oauth2/v1/token'

function loadToken() {
  if (fs.existsSync(TOKEN_PATH)) {
    const data = fs.readFileSync(TOKEN_PATH, 'utf8');
    return JSON.parse(data);
  }
  return null;
}

function saveToken(tokenObj) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokenObj, null, 2));
}

function isTokenValid(tokenObj) {
  if (!tokenObj || !tokenObj.access_token || !tokenObj.expires_at) return false;
  // Give a 60s buffer
  return Date.now() < tokenObj.expires_at - 60000;
}

function generateClientAssertion() {
  const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: CLIENT_ID,
    sub: CLIENT_ID,
    aud: TOKEN_ENDPOINT,
    jti: Math.random().toString(36).substring(2),
    exp: now + 300
  };
  return jwt.sign(payload, privateKey, { algorithm: 'RS256' });
}

async function fetchAccessToken() {
  const clientAssertion = generateClientAssertion();
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
  params.append('client_assertion', clientAssertion);

  const res = await axios.post(TOKEN_ENDPOINT, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  // Calculate expiry
  const expires_at = Date.now() + (res.data.expires_in * 1000);
  const tokenObj = {
    ...res.data,
    expires_at
  };
  saveToken(tokenObj);
  return tokenObj.access_token;
}

function getAccessTokenSync() {
  // For legacy sync usage, but not recommended for async flows
  const tokenObj = loadToken();
  if (isTokenValid(tokenObj)) {
    return tokenObj.access_token;
  }
  throw new Error('No valid IBKR access token found. Please use getAccessToken() async version.');
}

async function getAccessToken() {
  let tokenObj = loadToken();
  if (isTokenValid(tokenObj)) {
    return tokenObj.access_token;
  }
  // Fetch new token
  return await fetchAccessToken();
}

function updateAccessToken(newTokenObj) {
  saveToken(newTokenObj);
}

module.exports = {
  getAccessToken,
  getAccessTokenSync,
  updateAccessToken,
  loadToken,
  saveToken
};