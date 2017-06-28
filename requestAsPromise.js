const request = require('request');

module.exports = options => new Promise((resolve, reject) => {
  console.info('DEBUG', 'API Request', { url: options.url, options });
  request(options, (error, response, body) => {
    if (error) {
      console.info('DEBUG', 'API Response', { error });
      reject(error.toString());
    } else if (response && response.statusCode && !response.statusCode.toString().startsWith('2')) {
      console.info('DEBUG', 'API Response', { statusCode: response.statusCode });
      reject(new Error(`API request ${options.url} failed with status ${response.statusCode}`));
    } else {
      console.info('DEBUG', 'API Response', { url: options.url, body });
      resolve(body);
    }
  });
});
