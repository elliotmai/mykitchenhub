#!/bin/bash

# MyKitchenHub - Firebase Functions Setup Script
# Step 2.2: Firebase Cloud Functions Setup

echo "=================================="
echo "MyKitchenHub Functions Setup"
echo "Step 2.2 - Firebase Cloud Functions"
echo "=================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if Firebase CLI is installed
echo -e "${BLUE}Checking Firebase CLI installation...${NC}"
if ! command -v firebase &> /dev/null
then
    echo -e "${RED}Firebase CLI not found!${NC}"
    echo "Installing Firebase CLI..."
    npm install -g firebase-tools
    echo -e "${GREEN}✓ Firebase CLI installed${NC}"
else
    echo -e "${GREEN}✓ Firebase CLI already installed${NC}"
fi

echo ""

# Check Node.js version
echo -e "${BLUE}Checking Node.js version...${NC}"
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}✗ Node.js 18 or higher required (current: $(node -v))${NC}"
    echo "Please install Node.js 18 or higher from https://nodejs.org"
    exit 1
else
    echo -e "${GREEN}✓ Node.js version: $(node -v)${NC}"
fi

echo ""

# Login to Firebase
echo -e "${BLUE}Logging into Firebase...${NC}"
firebase login
echo ""

# Initialize Firebase in project (if not already done)
echo -e "${BLUE}Initializing Firebase project...${NC}"
if [ ! -f ".firebaserc" ]; then
    echo "Running firebase init..."
    firebase init functions
else
    echo -e "${GREEN}✓ Firebase project already initialized${NC}"
fi

echo ""

# Install dependencies in functions directory
echo -e "${BLUE}Installing function dependencies...${NC}"
cd functions
npm install

echo ""
echo -e "${GREEN}✓ Dependencies installed:${NC}"
echo "  - firebase-admin: Firebase Admin SDK"
echo "  - firebase-functions: Cloud Functions SDK"
echo "  - axios: HTTP client"

echo ""

# Create .env file from template
if [ ! -f ".env" ]; then
    echo -e "${BLUE}Creating .env file from template...${NC}"
    cp .env.template .env
    echo -e "${YELLOW}⚠ Please edit functions/.env and add your API keys${NC}"
else
    echo -e "${GREEN}✓ .env file already exists${NC}"
fi

cd ..

echo ""
echo "=================================="
echo -e "${GREEN}Setup Complete!${NC}"
echo "=================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Update .firebaserc with your actual project ID"
echo "   Current: $(cat .firebaserc | grep default | cut -d'"' -f4)"
echo ""
echo "2. Edit functions/.env with your API keys (for later phases)"
echo ""
echo "3. Test functions locally:"
echo "   ${BLUE}npm run serve${NC} (in functions directory)"
echo ""
echo "4. View the emulator UI:"
echo "   ${BLUE}http://localhost:4000${NC}"
echo ""
echo "5. Deploy functions to Firebase:"
echo "   ${BLUE}firebase deploy --only functions${NC}"
echo ""
echo "Available npm commands (in functions/ directory):"
echo "  - ${BLUE}npm run serve${NC}  : Start local emulator"
echo "  - ${BLUE}npm run deploy${NC} : Deploy to Firebase"
echo "  - ${BLUE}npm run logs${NC}   : View function logs"
echo "  - ${BLUE}npm test${NC}       : Run tests"
echo ""
echo "Function endpoints created:"
echo "  1. syncLegacyRecipes         (HTTP)"
echo "  2. importInventoryFromCSV    (HTTP)"
echo "  3. importHelloFreshFromPhoto (HTTP)"
echo "  4. sendDailyWasteAlerts      (Scheduled - 9 AM daily)"
echo "  5. generateMealPlan          (HTTP)"
echo ""
echo -e "${GREEN}All function stubs are ready for implementation!${NC}"
