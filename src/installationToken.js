const fs = require("fs");
const jwt = require("jsonwebtoken");
const requestp = require("./requestAsPromise");

const integrationId = Number(process.env.INTEGRATION_ID);

module.exports = installationId => {
  const cert = fs.readFileSync(process.env.INTEGRATION_KEY);
  const integrationToken = jwt.sign({ iss: integrationId }, cert, {
    algorithm: "RS256",
    expiresIn: "10m"
  });

  return requestp({
    url: `https://api.github.com/app/installations/${installationId}/access_tokens`,
    json: true,
    headers: {
      Authorization: `Bearer ${integrationToken}`,
      "User-Agent": "github-cla-bot",
      Accept: "application/vnd.github.machine-man-preview+json"
    },
    method: "POST"
  }).then(({ token }) => token);
};
