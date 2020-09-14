#!/bin/bash

tar cvf secrets.tar finos-cla-bot-staging.private-key.pem finos-cla-bot.private-key.pem src/serverless.env.yml
travis encrypt-file secrets.tar