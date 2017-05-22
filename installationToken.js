const fs = require('fs');
const jwt = require('jsonwebtoken');
const requestp = require('./requestAsPromise');

const integrationId = process.env.INTEGRATION_ID;

const cert = (process.env.INTEGRATION_KEY != null) ? fs.readFileSync(process.env.INTEGRATION_KEY) : "";
const token = (process.env.INTEGRATION_KEY != null) ? jwt.sign({ iss: integrationId },
  cert, {
    algorithm: 'RS256',
    expiresIn: '10m'
  }) : null;

module.exports = (installationId) => requestp({
  url: `https://api.github.com/installations/${installationId}/access_tokens`,
  json: true,
  headers: {
    'Authorization': 'Bearer ' + token,
    'User-Agent': 'github-cla-bot',
    'Accept': 'application/vnd.github.machine-man-preview+json'
  },
  method: 'POST'
})
.then(({token}) => token);
