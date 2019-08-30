const AWS = require("aws-sdk");

AWS.config.setPromisesDependency(Promise);

const s3 = new AWS.S3({ apiVersion: "2006-03-01" });

const loggedMessages = [];
const detailedLoggedMessages = [];
let logFile = "";

const logMessage = (level, message, detail) => {
  const logData = [new Date().toISOString(), level, message];
  // super crude filtering! these logs are displayed externally to end users
  // so we need to be v. careful about what is included.
  if (level !== "DEBUG") {
    loggedMessages.push(logData.join(" "));
  }
  logData.push(JSON.stringify(detail));
  detailedLoggedMessages.push(logData.join(" "));
  console.info(logData.join(" "));
};

const logger = {
  debug(message, detail) {
    logMessage("DEBUG", message, detail);
  },
  info(message, detail) {
    logMessage("INFO", message, detail);
  },
  error(message, detail) {
    logMessage("ERROR", message, detail);
  },
  logFile(filename) {
    loggedMessages.length = [];
    detailedLoggedMessages.length = [];
    logFile = filename;
  },
  flush() {
    if (process.env.JASMINE) {
      return Promise.resolve({});
    }

    return Promise.all([
      s3
        .putObject({
          Body: loggedMessages.join("\r\n"),
          Bucket: process.env.LOGGING_BUCKET,
          Key: logFile,
          ACL: "public-read",
          ContentType: "text/plain"
        })
        .promise(),
      s3
        .putObject({
          Body: detailedLoggedMessages.join("\r\n"),
          Bucket: process.env.LOGGING_BUCKET,
          Key: `${logFile}-DEBUG`,
          ACL: "public-read",
          ContentType: "text/plain"
        })
        .promise()
    ]);
  }
};

module.exports = logger;
