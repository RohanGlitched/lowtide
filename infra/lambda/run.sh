#!/bin/bash
# Lambda handler for the Next.js standalone server behind the AWS Lambda Web Adapter layer
# (AWS_LAMBDA_EXEC_WRAPPER=/opt/bootstrap): the adapter starts this, waits for /api/health on port 8080, then
# turns each Function URL request into an HTTP request to it, streaming the response back.
export PORT="${PORT:-8080}"
export HOSTNAME="${HOSTNAME_BIND:-127.0.0.1}"
exec node server.js
