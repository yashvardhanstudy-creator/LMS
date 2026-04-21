/**
 * @file Main Express application file for the Learning Management System (LMS).
 * @description This file sets up the Express server, defines routes, configures middleware,
 * and handles database interactions for a simple PDF note-sharing application.
 * @author Your Name/Team
 * @version 1.0.0
 */
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();
const app = express();
const PORT = process.env.PORT;

// --- Configuration ---
const UPLOAD_FOLDER = path.join(__dirname, "uploads");

// Ensure upload directory exists
fs.mkdirSync(UPLOAD_FOLDER, { recursive: true });

// --- Database Setup ---
/**
 * @description Initializes and connects to the SQLite database.
 * Creates the 'notes' and 'users' tables if they do not already exist.
 * The 'notes' table stores metadata about uploaded PDF files.
 * The 'users' table stores access codes and roles for authentication.
 */
const db = new sqlite3.Database("./notes.db", (err) => {
  if (err) {
    console.error(err.message);
  }
  console.log("Connected to the notes database.");
  db.serialize(() => {
    // Create notes table if it doesn't exist
    db.run(`CREATE TABLE IF NOT EXISTS notes
              (id INTEGER PRIMARY KEY AUTOINCREMENT,
               course TEXT,
               semester TEXT,
               subject TEXT,
               original_filename TEXT,
               saved_filename TEXT)`);

    // Create users table for access codes and roles
    db.run(`CREATE TABLE IF NOT EXISTS users
              (id INTEGER PRIMARY KEY AUTOINCREMENT,
               access_code TEXT UNIQUE NOT NULL,
               role TEXT NOT NULL)`);
  });
});

// --- Middleware ---
app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret: "a-very-secret-key-change-in-production",
    resave: false,
    saveUninitialized: true,
  }),
);

/**
 * Middleware to ensure a user is logged in before accessing a protected route.
 * If the user is not logged in, they are redirected to the /login page.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 * @param {function} next - The next middleware function.
 */
const requireLogin = (req, res, next) => {
  if (req.session.loggedIn) {
    next();
  } else {
    res.redirect("/login");
  }
};

/**
 * Middleware to ensure a user has an 'admin' role before accessing a protected route.
 * If the user is not an admin, they are redirected to the /upload page with an error message.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 * @param {function} next - The next middleware function.
 */
const requireAdmin = (req, res, next) => {
  if (req.session.loggedIn && req.session.role === "admin") {
    next();
  } else {
    req.session.message = "Access Denied: Admins only.";
    res.redirect("/upload");
  }
};

// --- Multer Configuration for File Uploads ---
/**
 * @description Configures multer for handling file uploads.
 * - `destination`: Determines the upload directory based on course, semester, and subject from the request body.
 *   It creates nested directories for organization.
 * - `filename`: Creates a unique, sanitized filename for the uploaded file to prevent conflicts and security issues.
 * - `fileFilter`: Ensures that only PDF files are accepted for upload.
 */
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const { course, semester, subject } = req.body;
    // Sanitize inputs to create a valid path
    const sanitizedCourse = course.replace(/[^a-z0-9]/gi, "_").toLowerCase();
    const sanitizedSemester = semester
      .replace(/[^a-z0-9]/gi, "_")
      .toLowerCase();
    const sanitizedSubject = subject.replace(/[^a-z0-9]/gi, "_").toLowerCase();

    const categoryPath = path.join(
      UPLOAD_FOLDER,
      sanitizedCourse,
      sanitizedSemester,
      sanitizedSubject,
    );
    fs.mkdirSync(categoryPath, { recursive: true }); // Create nested directories
    cb(null, categoryPath);
  },
  filename: function (req, file, cb) {
    const uniquePrefix = uuidv4().slice(0, 8);
    // Sanitize filename to prevent security issues
    const safeFilename = file.originalname.replace(/[^a-z0-9\._-]/gi, "_");
    cb(null, `${uniquePrefix}_${safeFilename}`);
  },
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== ".pdf") {
      return cb(new Error("Only PDF files are allowed!"), false);
    }
    cb(null, true);
  },
});

// --- Routes ---

/**
 * @route GET /
 * @description Renders the home page for students, displaying a list of available courses.
 * @returns {void} Renders the 'index.ejs' view with a list of courses.
 */
app.get("/", (req, res) => {
  const sql = "SELECT DISTINCT course FROM notes ORDER BY course";
  db.all(sql, [], (err, rows) => {
    if (err) throw err;
    res.render("index", { courses: rows });
  });
});

/**
 * @route GET /course/:courseName
 * @description Renders a page for a specific course, showing notes grouped by semester and subject.
 * @param {string} req.params.courseName - The name of the course to display.
 * @returns {void} Renders the 'course.ejs' view with grouped notes for the specified course.
 */
app.get("/course/:courseName", (req, res) => {
  const courseName = req.params.courseName;
  const sql = "SELECT * FROM notes WHERE course = ? ORDER BY semester, subject";
  db.all(sql, [courseName], (err, rows) => {
    if (err) throw err;

    // Group notes by semester -> subject (course is already filtered)
    const groupedNotes = {};
    rows.forEach((note) => {
      if (!groupedNotes[note.semester]) groupedNotes[note.semester] = {};
      if (!groupedNotes[note.semester][note.subject])
        groupedNotes[note.semester][note.subject] = [];
      groupedNotes[note.semester][note.subject].push(note);
    });

    res.render("course", { courseName, groupedNotes });
  });
});

/**
 * @route GET /search
 * @description Displays search results for notes based on a filename query.
 * @param {string} req.query.q - The search term for the filename.
 * @param {string} [req.query.course] - An optional filter to limit search to a specific course.
 * @returns {void} Renders the 'search.ejs' view with a list of matching notes.
 */
app.get("/search", (req, res) => {
  const query = req.query.q;
  const courseFilter = req.query.course;
  if (!query) return res.redirect("/");

  const sql =
    "SELECT * FROM notes WHERE original_filename LIKE ? AND course LIKE ? ORDER BY semester, subject";
  db.all(sql, [`%${query}%`, `%${courseFilter}%`], (err, rows) => {
    if (err) throw err;
    res.render("search", { query, results: rows });
  });
});

/**
 * @route GET /login
 * @description Renders the teacher/admin login page.
 * @returns {void} Renders the 'login.ejs' view.
 */
app.get("/login", (req, res) => {
  res.render("login", { message: req.session.message });
  delete req.session.message; // Clear message after displaying
});

/**
 * @route POST /login
 * @description Handles the login attempt for a teacher or admin.
 * It validates the provided access code against the database.
 * @param {string} req.body.accesscode - The access code submitted by the user.
 * @returns {void} Redirects to '/upload' on success or back to '/login' on failure.
 */
app.post("/login", (req, res) => {
  const accessCode = req.body.accesscode;
  const sql = "SELECT * FROM users WHERE access_code = ?";

  db.get(sql, [accessCode], (err, user) => {
    if (err) {
      console.error("Login DB error:", err.message);
      req.session.message = "A server error occurred. Please try again.";
      return res.redirect("/login");
    }

    if (user) {
      req.session.loggedIn = true;
      req.session.role = user.role;
      res.redirect("/upload");
    } else {
      req.session.message = "Invalid Access Code. Please try again.";
      res.redirect("/login");
    }
  });
});
/**
 * @route GET /logout
 * @description Logs out the current user by destroying the session.
 * @returns {void} Redirects to the home page ('/').
 */
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

/**
 * @route GET /upload
 * @description Renders the teacher upload portal. Displays the file upload form
 * and a list of all currently uploaded notes for management.
 * @requires Login
 * @returns {void} Renders the 'upload.ejs' view with existing notes and user role information.
 */
app.get("/upload", requireLogin, (req, res) => {
  const sql = "SELECT * FROM notes ORDER BY id DESC";
  db.all(sql, [], (err, rows) => {
    const existingCourses = [
      ...new Set((rows || []).map((note) => note.course)),
    ].sort();
    const existingSubjects = [
      ...new Set((rows || []).map((note) => note.subject)),
    ].sort();

    res.render("upload", {
      message: req.session.message,
      notes: rows || [],
      role: req.session.role,
      existingCourses,
      existingSubjects,
    });
    delete req.session.message;
  });
});

/**
 * @route POST /upload
 * @description Handles the file upload process. A single PDF file is processed by multer,
 * saved to the server, and its metadata is stored in the database.
 * @requires Login
 * @param {object} req.body - Contains form data: course, semester, subject.
 * @param {object} req.file - The uploaded file object from multer.
 * @returns {void} Redirects back to the '/upload' page with a success or error message.
 */
app.post("/upload", requireLogin, upload.single("note_file"), (req, res) => {
  const { course, semester, subject } = req.body;
  const original_filename = req.file.originalname;
  const saved_filename = req.file.filename;

  const sql = `INSERT INTO notes (course, semester, subject, original_filename, saved_filename) VALUES (?, ?, ?, ?, ?)`;
  db.run(
    sql,
    [course, semester, subject, original_filename, saved_filename],
    (err) => {
      if (err) {
        req.session.message = "Database error: " + err.message;
      } else {
        req.session.message = "Note uploaded successfully!";
      }
      res.redirect("/upload");
    },
  );
});

/**
 * @route POST /delete/:note_id
 * @description Deletes a specific note from both the filesystem and the database.
 * @requires Login
 * @param {number} req.params.note_id - The ID of the note to be deleted.
 * @returns {void} Redirects back to the '/upload' page with a status message.
 */
app.post("/delete/:note_id", requireLogin, (req, res) => {
  const { note_id } = req.params;
  const sqlSelect = "SELECT * FROM notes WHERE id = ?";

  db.get(sqlSelect, [note_id], (err, note) => {
    if (err || !note) {
      req.session.message = "Note not found.";
      return res.redirect("/upload");
    }

    const sanitizedCourse = note.course
      .replace(/[^a-z0-9]/gi, "_")
      .toLowerCase();
    const sanitizedSemester = note.semester
      .replace(/[^a-z0-9]/gi, "_")
      .toLowerCase();
    const sanitizedSubject = note.subject
      .replace(/[^a-z0-9]/gi, "_")
      .toLowerCase();

    const filePath = path.join(
      UPLOAD_FOLDER,
      sanitizedCourse,
      sanitizedSemester,
      sanitizedSubject,
      note.saved_filename,
    );

    // Delete from filesystem
    fs.unlink(filePath, (err) => {
      // We ignore "ENOENT" (file not found) to allow DB cleanup even if the file is missing
      if (err && err.code !== "ENOENT")
        console.error("File deletion error:", err);

      // Delete from database
      const sqlDelete = "DELETE FROM notes WHERE id = ?";
      db.run(sqlDelete, [note_id], (err) => {
        req.session.message = err
          ? "Error deleting note from database."
          : "Note deleted successfully.";
        res.redirect("/upload");
      });
    });
  });
});

// --- Admin Routes ---

/**
 * @route GET /admin
 * @description Renders the admin dashboard for managing user access codes.
 * @requires Admin
 * @returns {void} Renders the 'admin.ejs' view with a list of current users and their roles.
 */
app.get("/admin", requireAdmin, (req, res) => {
  const sql = "SELECT id, role, access_code FROM users ORDER BY role";
  db.all(sql, [], (err, users) => {
    res.render("admin", { message: req.session.message, users: users || [] });
    delete req.session.message;
  });
});

/**
 * @route POST /admin/update-code
 * @description Handles the logic for updating an access code for a specific role (teacher or admin).
 * @requires Admin
 * @param {string} req.body.target_role - The role ('teacher' or 'admin') whose code is to be updated.
 * @param {string} req.body.new_access_code - The new access code to set for the role.
 * @returns {void} Redirects back to the '/admin' page with a status message.
 */
app.post("/admin/update-code", requireAdmin, (req, res) => {
  const { target_role, new_access_code } = req.body;

  const sql = "UPDATE users SET access_code = ? WHERE role = ?";
  db.run(sql, [new_access_code, target_role], function (err) {
    if (err) {
      if (err.message.includes("UNIQUE constraint failed")) {
        req.session.message = "Error: This access code is already in use.";
      } else {
        req.session.message = "Database error: " + err.message;
      }
    } else if (this.changes === 0) {
      req.session.message = "Error: Role not found.";
    } else {
      req.session.message = `Successfully updated access code for ${target_role}.`;
    }
    res.redirect("/admin");
  });
});

/**
 * @route GET /download/:note_id
 * @description Allows a user to download or view a specific note file.
 * @param {number} req.params.note_id - The ID of the note to be downloaded.
 * @returns {void} Sends the requested file as a response or a 404 error if not found.
 */
app.get("/download/:note_id", (req, res) => {
  const { note_id } = req.params;
  const sql = "SELECT * FROM notes WHERE id = ?";
  db.get(sql, [note_id], (err, note) => {
    if (err || !note) {
      return res.status(404).send("Note not found.");
    }
    const sanitizedCourse = note.course
      .replace(/[^a-z0-9]/gi, "_")
      .toLowerCase();
    const sanitizedSemester = note.semester
      .replace(/[^a-z0-9]/gi, "_")
      .toLowerCase();
    const sanitizedSubject = note.subject
      .replace(/[^a-z0-9]/gi, "_")
      .toLowerCase();

    const filePath = path.join(
      UPLOAD_FOLDER,
      sanitizedCourse,
      sanitizedSemester,
      sanitizedSubject,
      note.saved_filename,
    );
    res.sendFile(filePath, (err) => {
      if (err) {
        res.status(404).send("File not found on server.");
      }
    });
  });
});

// --- Start Server ---
app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Server is running on port ${PORT}. Access it on your network via your machine's IP address (e.g., http://192.168.x.x:${PORT}).`,
  );
});
