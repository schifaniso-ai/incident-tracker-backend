
async function testLogin() {
  try {
    const response = await fetch(
      'http://localhost:5000/api/auth/login',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: 'teststaff@example.com',
          password: 'TestPass123!'
        })
      }
    );

    const data = await response.json();

    console.log('Status:', response.status);
    console.log('Response:', data);
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

testLogin();
