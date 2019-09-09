const request = require("request");
const logger = require("./logger");

module.exports = options =>
  new Promise((resolve, reject) => {
    logger.info(`API Request ${options.url}`, options);
    request(options, (error, response, body) => {
      if (error) {
        logger.debug(`API Response ${options.url}`, { error });
        reject(error.toString());
      } else if (
        response &&
        response.statusCode &&
        !response.statusCode.toString().startsWith("2")
      ) {
        logger.debug(`API Response ${options.url}`, {
          statusCode: response.statusCode
        });
        reject(
          new Error(
            `API request ${options.url} failed with status ${response.statusCode}`
          )
        );
      } else {
        logger.debug(`API Response ${options.url}`, body);
        resolve(body);
      }
    });
  });
