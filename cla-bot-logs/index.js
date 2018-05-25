const AWS = require('aws-sdk');

const dynamodb = new AWS.DynamoDB.DocumentClient();

const response = body => ({
  statusCode: 200,
  headers: {
    'Access-Control-Allow-Origin': '*'
  },
  body: JSON.stringify(body)
});

exports.handler = (event, lambdaContext, callback) => {
  const query = event.queryStringParameters;

  const loggingCallback = (error, message) => {
    console.info('callback', error, message);
    callback(error, response(message));
  };

  const params = {
    TableName: process.env.LOGGING_TABLE,
    KeyConditionExpression: 'correlationKey = :key',
    ExpressionAttributeValues: {
      ':key': query.correlationKey
    }
  };

  dynamodb.query(params, (err, data) => {
    if (err) {
      console.log(err, err.stack);
    }
    data.Items = data.Items.filter(d => d.level !== 'DEBUG');
    loggingCallback(null, data.Items);
  });
};
