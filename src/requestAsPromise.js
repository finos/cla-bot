const request = require("request");
const logger = require("./logger");

const isSuccess = (options, statusCode) => {
  if (options.method === "DELETE") {
    return (
      statusCode.toString().startsWith("2") || statusCode.toString() === "404"
    );
  } else {
    return statusCode.toString().startsWith("2");
  }
};

module.exports = options =>
  new Promise((resolve, reject) => {
    const logUrl = options.url.split("?")[0];
    logger.info(`API Request ${logUrl}`, options);
    request(options, (error, response, body) => {
      if (error) {
        logger.debug(`API Response ${logUrl}`, { error });
        reject(error.toString());
      } else if (
        response &&
        response.statusCode &&
        !isSuccess(options, response.statusCode)
      ) {
        logger.debug(`API Response ${logUrl}`, {
          statusCode: response.statusCode
        });
        reject(
          new Error(
            `API request ${logUrl} failed with status ${response.statusCode}`
          )
        );
      } else {
        logger.debug(`API Response ${logUrl}`, body);
        resolve(body);
      }
    });
  });
