#!/bin/bash
set -e

# Wait for backend
echo "Waiting for backend to be ready..."
MAX_RETRIES=60
count=0
until curl -s http://localhost:8080/health > /dev/null; do
  sleep 2
  echo -n "."
  count=$((count+1))
  if [ $count -ge $MAX_RETRIES ]; then
    echo " Timeout waiting for backend!"
    exit 1
  fi
done
echo " Backend is ready!"

# Create Organization
echo "Creating organization..."
ORG_NAME="Test Org $(date +%s)"
ORG_SLUG="test-org-$(date +%s)"

RESPONSE=$(curl -s -X POST http://localhost:8080/api/v1/organizations \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"$ORG_NAME\", \"slug\": \"$ORG_SLUG\"}")

if echo "$RESPONSE" | grep -q "organization"; then
  echo "Organization created."
  # Extract API Key
  API_KEY=$(echo "$RESPONSE" | node -e "console.log(JSON.parse(fs.readFileSync(0)).api_key.key)")
  
  if [ -z "$API_KEY" ] || [ "$API_KEY" == "undefined" ]; then
    echo "Failed to extract API key. Response: $RESPONSE"
    exit 1
  fi
  
  echo "Got API Key: ${API_KEY:0:10}..."
  
  # Export env vars for test script
  export API_KEY=$API_KEY
  export BASE_URL="http://localhost:8080"
  export GRPC_ADDRESS="localhost:50051"
  export SKIP_GRPC="0"
  export VERBOSE="1"
  
  # Run tests
  echo "Running tests..."
  npx tsx scripts/test-local.ts
else
  echo "Failed to create organization. Response: $RESPONSE"
  exit 1
fi
