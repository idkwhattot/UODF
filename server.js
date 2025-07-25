const express = require("express");
const multer = require("multer");
const session = require("express-session");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const archiver = require("archiver");

const app = express();
const PORT = 3000;

const users = {}; // In-memory user store: username => {password}
const userUploads = {}; // username => array of uploads

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: "supersecretkey",
  resave: false,
  saveUninitialized: false,
}));

// Serve static files from root (index.html and CSS/JS if any)
app.use(express.static(__dirname));

function requireLogin(req, res, next) {
  if (!req.session.username) return res.redirect("/login");
  next();
}

// ----- AUTH ROUTES -----

app.get("/login", (req, res) => {
  res.send(`
    <style>
      body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background:#f0f2f5; display:flex; height:100vh; justify-content:center; align-items:center; }
      form { background:white; padding:2rem; border-radius:8px; box-shadow:0 2px 10px rgba(0,0,0,0.1); width:320px; }
      h2 { margin-bottom:1rem; }
      input { width:100%; padding:0.5rem; margin:0.5rem 0 1rem; border:1px solid #ccc; border-radius:4px; font-size:1rem; }
      button { width:100%; padding:0.7rem; background:#4caf50; border:none; border-radius:4px; color:white; font-weight:bold; font-size:1rem; cursor:pointer; }
      a { color:#4caf50; text-decoration:none; display:block; margin-top:1rem; text-align:center; }
    </style>
    <form method="post" action="/login" autocomplete="off">
      <h2>Login</h2>
      <input name="username" placeholder="Username" required autofocus />
      <input type="password" name="password" placeholder="Password" required />
      <button type="submit">Login</button>
      <a href="/signup">Don't have an account? Sign up</a>
    </form>
  `);
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (users[username] && users[username].password === password) {
    req.session.username = username;
    return res.redirect("/uploader");
  }
  res.send(`<p>Invalid credentials. <a href="/login">Try again</a></p>`);
});

app.get("/signup", (req, res) => {
  res.send(`
    <style>
      body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background:#f0f2f5; display:flex; height:100vh; justify-content:center; align-items:center; }
      form { background:white; padding:2rem; border-radius:8px; box-shadow:0 2px 10px rgba(0,0,0,0.1); width:320px; }
      h2 { margin-bottom:1rem; }
      input { width:100%; padding:0.5rem; margin:0.5rem 0 1rem; border:1px solid #ccc; border-radius:4px; font-size:1rem; }
      button { width:100%; padding:0.7rem; background:#2196f3; border:none; border-radius:4px; color:white; font-weight:bold; font-size:1rem; cursor:pointer; }
      a { color:#2196f3; text-decoration:none; display:block; margin-top:1rem; text-align:center; }
    </style>
    <form method="post" action="/signup" autocomplete="off">
      <h2>Sign Up</h2>
      <input name="username" placeholder="Username" required autofocus />
      <input type="password" name="password" placeholder="Password" required />
      <button type="submit">Sign Up</button>
      <a href="/login">Already have account? Login</a>
    </form>
  `);
});

app.post("/signup", (req, res) => {
  const { username, password } = req.body;
  if (users[username]) {
    return res.send(`<p>Username taken. <a href="/signup">Try again</a></p>`);
  }
  users[username] = { password };
  req.session.username = username;
  res.redirect("/uploader");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// ----- MAIN UPLOADER PAGE -----

app.get("/uploader", requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ----- UPLOAD HANDLER -----

app.post("/upload", requireLogin, (req, res) => {
  const uploadId = uuidv4();
  const username = req.session.username;
  const uploadPath = path.join(__dirname, "uploads", username, uploadId);

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dest = path.join(uploadPath, path.dirname(file.originalname));
      fs.mkdirSync(dest, { recursive: true });
      cb(null, dest);
    },
    filename: (req, file, cb) => cb(null, path.basename(file.originalname))
  });

  const upload = multer({ storage }).array("files");

  upload(req, res, err => {
    if (err) return res.status(500).send("Upload failed.");

    const uploadedFiles = req.files.map(file => ({
      name: file.originalname,
      url: `/uploads/${username}/${uploadId}/${file.originalname}`
    }));

    if (!userUploads[username]) userUploads[username] = [];

    userUploads[username].push({
      id: uploadId,
      folderLink: `/download/${username}/${uploadId}`,
      files: uploadedFiles
    });

    res.json({
      id: uploadId,
      folderLink: `/download/${username}/${uploadId}`,
      files: uploadedFiles,
      username
    });
  });
});

// ----- GET USER UPLOADS -----

app.get("/myuploads", requireLogin, (req, res) => {
  res.json(userUploads[req.session.username] || []);
});

// ----- DOWNLOAD ZIP -----

app.get("/download/:username/:id", requireLogin, (req, res) => {
  if (req.params.username !== req.session.username) return res.status(403).send("Forbidden");

  const folderPath = path.join(__dirname, "uploads", req.params.username, req.params.id);
  if (!fs.existsSync(folderPath)) return res.status(404).send("Folder not found");

  const archive = archiver("zip", { zlib: { level: 9 } });
  res.attachment(`${req.params.id}.zip`);
  archive.directory(folderPath, false);
  archive.pipe(res);
  archive.finalize();
});

// ----- SERVE UPLOADED FILES WITH PROTECTION -----

app.use("/uploads/:username", requireLogin, (req, res, next) => {
  if (req.params.username !== req.session.username) return res.status(403).send("Forbidden");
  express.static(path.join(__dirname, "uploads", req.params.username))(req, res, next);
});

// ----- ROOT REDIRECT -----

app.get("/", (req, res) => {
  if (req.session.username) return res.redirect("/uploader");
  res.redirect("/login");
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
