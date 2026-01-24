#!/bin/bash

# MyKitchenHub Firebase Setup Script
# Run this after completing the manual Firebase Console setup

echo "🔥 MyKitchenHub Firebase Setup"
echo "==============================="
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18.x first."
    exit 1
fi

echo "✅ Node.js version: $(node -v)"
echo ""

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "✅ npm version: $(npm -v)"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo ""
echo "✅ Dependencies installed successfully!"
echo ""

# Check for .env file
if [ ! -f .env ]; then
    echo "⚠️  No .env file found!"
    echo ""
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo ""
    echo "📝 IMPORTANT: Edit the .env file with your Firebase credentials!"
    echo "   Get them from: Firebase Console → Project Settings → Your apps"
    echo ""
    echo "   Required values:"
    echo "   - REACT_APP_FIREBASE_API_KEY"
    echo "   - REACT_APP_FIREBASE_AUTH_DOMAIN"
    echo "   - REACT_APP_FIREBASE_PROJECT_ID"
    echo "   - REACT_APP_FIREBASE_STORAGE_BUCKET"
    echo "   - REACT_APP_FIREBASE_MESSAGING_SENDER_ID"
    echo "   - REACT_APP_FIREBASE_APP_ID"
    echo ""
else
    echo "✅ .env file exists"
fi

echo ""
echo "==============================="
echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "1. Make sure you've completed Firebase Console setup (see firebase-setup-guide.md)"
echo "2. Edit .env with your Firebase credentials"
echo "3. Run 'npm start' to test the connection"
echo ""
echo "The app will show a Firebase Connection Test page."
echo "Use it to verify Auth and Firestore are working."
echo ""
