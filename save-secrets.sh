#!/bin/bash

tar cvf secrets.tar clabot-dev-integration-key.pem clabot-integration-key.pem cla-bot/serverless.env.yml
travis encrypt-file secrets.tar