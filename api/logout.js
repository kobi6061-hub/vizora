// Clears the session cookie and returns to the access page.
module.exports = (req, res) => {
  res.setHeader(
    'Set-Cookie',
    'kobix_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
  );
  res.statusCode = 302;
  res.setHeader('Location', '/login.html');
  res.end();
};
