import bcrypt from 'bcryptjs';

bcrypt.hash('Admin123', 10).then(hash => {
  console.log(hash);
});