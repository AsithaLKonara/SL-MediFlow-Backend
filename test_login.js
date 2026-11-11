const axios = require('axios');

async function testLogin(email, password) {
  try {
    const res = await axios.post('http://localhost:5000/api/auth/login', { email, password });
    console.log(`Success for ${email}:`, res.data.user.role);
  } catch (err) {
    console.error(`Failed for ${email}:`, err.response?.data || err.message);
  }
}

async function main() {
  await testLogin('admin@slmediflow.com', 'password123');
  await testLogin('doctor@slmediflow.com', 'password123');
  await testLogin('frontdesk@slmediflow.com', 'password123');
  await testLogin('reception@slmediflow.com', 'password123');
  await testLogin('labtech@slmediflow.com', 'password123');
}

main();
