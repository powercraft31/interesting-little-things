// ============================================
// BFF API Configuration
// ============================================
// After AWS deployment, replace BFF_API_URL with the CDK output:
//   BffStack.BffApiUrl (e.g. https://xxxxxx.execute-api.sa-east-1.amazonaws.com)
// Set USE_MOCK to false to fetch data from the BFF Lambda endpoints.
// ============================================

// eslint-disable-next-line no-unused-vars
const CONFIG = {
  BFF_API_URL: "http://localhost:3001",
  USE_MOCK: true,
};
