const fetch = require('node-fetch');

async function test() {
  const url = 'http://localhost:3000/api/auth/create-profile';
  
  console.log("Testing Signup with email NOT in allowed_schools...");
  const res1 = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uid: 'test-uid-1',
      email: 'not-allowed@example.com',
      name: 'Test Not Allowed',
      role: 'school'
    })
  });
  const data1 = await res1.json();
  console.log("Result 1:", res1.status, data1);
  
  console.log("\nNow testing Admin Pre-register...");
  // We don't have an endpoint for pre-register, the app uses Firebase directly.
  // We can just add it directly using Firebase Admin SDK.
}
test();
