# Deployment instructions

In order to deploy cla-bot on AWS, please follow the steps below.

## AWS Resources

### Create IAM user
- Access IAM service from AWS Dashboard
- On `Access Type`, check `Programmatic access`
- When done, save `Access key ID` as `AWS_ACCESS_KEY_ID` and `Secret Access key` as `AWS_SECRET_ACCESS_KEY`

### Create IAM role
- Choose `AWS Service Role`
- on `AWS Lambda` row, click on `Select`
- Select `AWSLambdaFullAccess` and `IAMFullAccess` and click on `Next Step`
- Set Role name as `cla-bot-role` and click on `Create role`
- Click on the newly created `cla-bot-role` and save `Role ARN` as `WS_ROLE_ARN`

### Create DynamoDB Tables
- Access 
- Name: same as `LOGGING_TABLE` defined in the `<environment>.env` file
- Primary key: `correlationKey`
- Check `Add sort key` and set `time` as field value

## GitHub Configuration

### Setup a Github App
- Log into Github.com
- Access https://github.com/settings/apps/new
- Set homepage URL to https://finos.github.io/cla-bot
- Set `User authorization callback URL` and `Webhook URL` to `http://google.com`; you'll change it later on, as soon as the APIs are properly configured
- Set `Homepage URL` to `https://colineberhardt.github.io/cla-bot`
- On Permissions:
  - `Repository contents` set to `Read-only`
  - `Issues` set to `Read & write`
  - `Pull requests` set to `Read & write`
  - `Commit statuses` set to `Read & write`
- On `Subscribe to Events`, check:
  - `Pull Request`
  - `Status`
  - `Issue comment`
- Set `Only on this account` to `Where can this GitHub App be installed?`
- Click on `Save`
- Click on `Generate Private Key` and download it locally
- Save `INTEGRATION_KEY` as the local path to the downloaded file, `INTEGRATION_ID` as the 4-digits number reported on the top right of the Github App screen and `BOT_NAME` as the name of the Github App

### Install the Github App
Click on the `Install` button (top-right of Github App page) and enable it only for the current account, only on one repository.

Important! Make sure that you also add `clabot-config` repository at org level, if you want to use the same configuration across all org repositories.

In the permissions tab, add all the items reported in the screenshot posted in [this gist comment](https://gist.github.com/maoo/16b4a683e8cf9ae4b466ace0ae745497#gistcomment-2146379)

### Create Github Personal Access Token
Follow [github docs](https://help.github.com/articles/creating-a-personal-access-token-for-the-command-line/) and save the generated token as `GITHUB_ACCESS_TOKEN`; no scopes or permissions must be defined, all items must be unchecked; however, if you want to use a `clabot-config` private repository, you'd need to check `repo` (` Full control of private repositories`).

## Creating APIs using the API Gateway (for logs functions)
For each of the <environment> values, you will need to create an API for logs - ie `clabot-<environment>-logs` - that you can create right now, and Main lambda function - ie `clabot-<environment>-lambda` - that you can create after you deploy and configure the logs functions.

To create an API, access the [API Gateway console](https://console.aws.amazon.com/apigateway/home) and follow these steps
- Click on `Create API`
  - API Name: `cla-bot-<environment>-lambda`
  - Endpoint type: `Edge Optimized`
- Select `Resources` from the left menu, click on `Actions > Create Method`
- Choose `POST` as method and confirm
- Define `Lambda Region` field to match `<AWS_REGION>`
- Set `Lambda Function` to any existing function for now; you'll change it as soon as the bot lambda functions are deployed (see below)
- Click on Save; a dialog `Add Permission to Lambda Function` will show up, click on `Ok`
- Click on `Integration Request` and extend `Body Mapping Templates`
- Select `When there are no templates defined (recommended)` for field `Request body passthrough`
- Click on `Add mapping template`, type `application/json` for "Content-Type", confirm and paste the following content in the text area:
```
{
  "body" : $input.json('$'),
  "headers": {
    #foreach($header in $input.params().header.keySet())
    "$header": "$util.escapeJavaScript($input.params().header.get($header))" #if($foreach.hasNext),#end

    #end
  },
  "method": "$context.httpMethod",
  "params": {
    #foreach($param in $input.params().path.keySet())
    "$param": "$util.escapeJavaScript($input.params().path.get($param))" #if($foreach.hasNext),#end

    #end
  },
  "query": {
    #foreach($queryParam in $input.params().querystring.keySet())
    "$queryParam": "$util.escapeJavaScript($input.params().querystring.get($queryParam))" #if($foreach.hasNext),#end
    #end
  }  
}
```
- Click on `Save`
- Click on `Actions > Deploy API`
- Select `[New Stage]` as `Deployment Stage`
- Type `<environment>` (or `logs`, if you're creating the logs API)
- Save the `Invoke URL` as `API_URL`

### Configuring HTML payload for logs endpoints

In order to show a nice HTML output on the logs pages, it is necessary to configure few additional items in the API Gateway definition:
- Via the API `Models` menu, click on `Create`
  - Set `Model Name` to `ClaBotLogs`
  - Set `Content type` to `text/html`
  - Set `Model Schema` to the following:
```
{
  "$schema": "http://json-schema.org/draft-04/schema#",
  "title": "ClaBotLogs",
  "type": "array",
  "items" : {
    "type": "object",
    "properties": {
      "uuid": { "type": "string" },
      "correlationKey": { "type": "string" },
      "level": { "type": "string" },
      "time": { "type": "string" },
      "message": { "type": "string" }
    }
  }
}
```

- Via the API `Resources` menu, open `Method Response`
- For the `200` response
  - add a `Response Header` called `Content-Type`
  - add a `Response Body` with Content type `text/html` and `ClaBotLogs` as model
- Via the API `Resources` menu, open `Integration Response`
- In `Header Mappings` set `Content-Type` as `Response header` and `'text/html'` as `Mapping Value`
- In `Body Mapping Templates` , add a `text/html` content type and set the following template:
```
#set($allParams = $input.params())
<html>
<head>
    <title>FINOS cla-bot logs</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/4.0.0/css/bootstrap.min.css" integrity="sha384-Gn5384xqQ1aoWXA+058RXPxPg6fy4IWvTNh0E263XmFcJlSAwiGgFAW/dAiS6JXm" crossorigin="anonymous">
</head>
<body>
    <h1>FINOS cla-bot logs</h1>
    <table class="table">
        <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Log Level</th>
              <th scope="col">Message</th>
            </tr>
        </thead>
        <tbody>
            #foreach($message in $input.path('$'))
                <tr>
                <th scope="row" title="Key: $message.correlationKey">$message.time</th>
                <td>$message.level</td>
                <td>$message.message</td>
              </tr>
            #end
        </tbody>
    </table>
</body>
</html>
```

If you have problems invoking the Lambda function, check the [Lambda role configurations](https://github.com/awslabs/serverless-application-model/issues/59#issuecomment-296681182) and enable API Logging (via the API Stage Editor)

## Configure cla-bot-logs module

### create `env` files

Within the `cla-bot-logs` sub-folder, create the following files.

`.env`:
```
AWS_ACCESS_KEY_ID=<AWS Access Key>
AWS_SECRET_ACCESS_KEY=<AWS Secret Key>
AWS_ROLE=arn:aws:iam::<AWS Account ID>:role/service-role/<AWS IAM Role Name>
AWS_REGION=us-east-1
AWS_HANDLER=index.handler
AWS_MEMORY_SIZE=128
AWS_TIMEOUT=300
AWS_RUNTIME=nodejs6.10
```

For each environment (in our case, we have `staging` and `prod`), create <environment>.env:

```
LOGGING_TABLE=clabot-log-<environment>
```

### Run node-lambda deployment for cla-bot-logs module

```
cd ./cla-bot-logs
node-lambda deploy --configFile <environment>.env -n cla-bot-<environment>-logs
```

## Configure cla-bot module

### create `env` files

Within the `cla-bot` sub-folder, create the following files.

`.env`:
```
AWS_ACCESS_KEY_ID=<AWS Access Key>
AWS_SECRET_ACCESS_KEY=<AWS Secret Key>
AWS_ROLE=arn:aws:iam::<AWS Account ID>:role/service-role/<AWS IAM Role Name>
AWS_REGION=us-east-1
AWS_HANDLER=index.handler
AWS_MEMORY_SIZE=128
AWS_TIMEOUT=300
AWS_RUNTIME=nodejs6.10
```

For each environment (in our case, we have `staging` and `prod`), create <environment>.env:

```
AWS_ENVIRONMENT=<environment>
GITHUB_ACCESS_TOKEN=<GitHub Token>
LOG_URL=<The env specific "Invoke URL" from the cla-bot-logs>
INTEGRATION_ENABLED=false
INTEGRATION_KEY=<GitHub App pem key>
INTEGRATION_ID=<GitHub App ID>
BOT_NAME=cla-bot-<environment>
LOGGING_TABLE=clabot-log-<environment>
```

Please note that - if `GITHUB_ACCESS_TOKEN` is defined, `INTEGRATION_ENABLED` MUST be set to `false` (otherwise the GitHub Access Token will not be used and the cla-bot fill fail accessing clabot-config, if private)

### Run node-lambda deployment for cla-bot module

```
node-lambda deploy --configFile <environment>.env -n cla-bot-<environment>-lambda
```

### Complete configuration
Make sure that, for each <environment>:
- the `API Gateway > Stage > POST Method > Integration Request > Lambda Function` points to the right Lambda function. ie `<AWS_FUNCTION_NAME>-lambda`; after changing this configuration, you **must redeploy the API** (using `Actions > Deploy API`)
- The GitHub App `User authorization callback URL` and `Webhook URL` are pointing to the APIs `Invoke URL`

## Debug
- To check URLs, run `curl -H "Content-Type: application/json" -X POST <Invoke URL>`; if you either get `Process exited before completing request` or `ignored action of type undefined`, it means Lambda function was invoked

- To debug API invoking Lambda, use the [Test Method Console](https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-test-method.html#how-to-test-method-console)

## Common issue with Lambda permissions
If you see something like this in the CloudWatch API logs, you need to re-permission the lambda function to the related API Gateway (see **Complete configuration** right above)

```
(f3ce6e03-582b-11e8-8f3a-cfe9e4701f18) Execution failed due to configuration error: Invalid permissions on Lambda function
```

You need to access the API Gateway, 
### Using Postman
- Open [Postman](https://chrome.google.com/webstore/detail/postman/fhbjgbiflinjbdggehcddcbncdddomop?hl=en) (or similar)
- Set method to `POST`
- Set URL as `<API_URL>` (see step #8)
- Add header param `Content-type` with value `application/json`
- Send the request
- Check the response from Postman
- Check AWS Cloudwatch logs, see if they match
