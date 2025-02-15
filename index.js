const express = require('express')
const path = require('path')
const cors = require('cors');
const { faker } = require("@faker-js/faker");
const multer = require('multer');
const FormData = require("form-data");
const axios = require("axios");

const session = require("express-session");
const MongoStore = require("connect-mongo");
const bcrypt = require("bcryptjs");

const connectDB = require("./db");
const isAuthenticated = require("./middleware/auth");
const flash = require('connect-flash');
const { redirect } = require('express/lib/response');
const req = require('express/lib/request');
const { ObjectId } = require('mongodb');
const bodyParser = require('body-parser');
// const { isatty } = require('tty');

require("dotenv").config();

const app = express()
const port = 3000

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(flash());

app.use(cors({
    origin: 'http://localhost:3000'
}));

const noticeStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, '/public/notices')); // Save in /public/notices
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const uploadNotice = multer({ storage: noticeStorage });

const homeworkStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, '/public/homeworks')); // Save in /public/homework
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const uploadHomework = multer({ storage: homeworkStorage });

const attendanceFileStorage = multer.memoryStorage();
const attendanceFile = multer({ storage: attendanceFileStorage });

app.use(bodyParser.json());
app.use('/notices', express.static(path.join(__dirname, 'public/notices')));
app.use('/homeworks', express.static(path.join(__dirname, 'public/homworks')))

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { maxAge: 1000 * 60 * 60 * 2 } // 2-hour session
}));

let db;
connectDB().then(database => {
    db = database;
});

app.set('view engine', 'hbs')

app.set('views', path.join(__dirname, 'views'))

app.use(express.static(path.join(__dirname, 'public')))

// *************** routes *********************

app.get('/login', async (req, res) => {
    const errorMessage = req.flash('error')[0] || 'hidden'; // hidden -> tailwind class to hide element
    const username = req.flash('uname')[0] || '';
    res.render("login", { error: errorMessage, uname: username });

})
app.post('/login', async (req, res) => {
    try {
        const { uname, password } = req.body;
        const user = await db.collection("users").findOne({ uname });

        if (!user || !(await bcrypt.compare(password, user.password))) {
            req.flash('error', 'block'); // block -> tailwind class to show element
            req.flash('uname', uname);
            return res.redirect("/login");
        }
        console.log(user)
        req.session.user = { id: user._id, uname: user.uname, role: user.role, refId: user.refId };
        res.redirect("/");
    } catch (error) {
        console.error(error);
        res.status(500).send("Internal Server Error");
    }
})
app.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/login");
    });
})
app.get('/', isAuthenticated, async (req, res) => {
    _id = new ObjectId(req.session.user.refId)
    user = await db.collection(`${req.session.user.role}s`).findOne({ "_id": _id })
    user.uname = req.session.user.uname
    user.role = req.session.user.role
    res.render('index', { user: user })
})
app.post('/attendance/mark', async (req, res) => {


    const { date, std, attendance } = req.body;

    try {
        // Connect to the database
        const studentsCollection = db.collection('students');

        // Convert the date to ISO format
        const formattedDate = new Date(date);

        // Iterate over the attendance array
        for (let entry of attendance) {
            const { uid, status } = entry;

            // Find the student by uid
            const student = await studentsCollection.findOne({ uid: uid });

            if (!student) {
                return res.status(404).send(`Student with UID ${uid} not found`);
            }

            // Initialize attendance field if it doesn't exist
            if (!student.attendance) {
                student.attendance = [];
            }
            // Check if attendance for the given date already exists
            const existingAttendance = student.attendance.find(
                (entry) => new Date(entry.date).toISOString() === formattedDate.toISOString()
            );

            if (existingAttendance) {
                // If attendance for the date exists, update the status
                await studentsCollection.updateOne(
                    { uid: uid, 'attendance.date': formattedDate },
                    {
                        $set: {
                            'attendance.$.status': status, // Update the status
                        },
                    }
                );
            } else {
                // If no attendance entry for the date, add a new one
                await studentsCollection.updateOne(
                    { uid: uid },
                    {
                        $push: {
                            attendance: { date: formattedDate, status: status }, // Add new attendance entry
                        },
                    }
                );
            }
        }

        res.status(200).send('Attendance updated/added successfully.');
    } catch (err) {
        console.error('Error updating attendance:', err);
        res.status(500).send('Error updating attendance');
    }
});
app.get("/attendance/view", isAuthenticated, async (req, res) => {
    if (req.session.user.role === 'teacher') {
        const { date } = req.query;
        console.log(date)
        if (!date) {
            return res.status(400).send("Date is required");
        }

        const formattedDate = new Date(date);
        console.log(formattedDate)

        try {
            // Fetch all students
            const students = await db.collection("students").find({}).toArray();

            // Fetch attendance for the specific date
            const attendanceData = await db.collection("students").aggregate([
                { $unwind: "$attendance" },
                { $match: { "attendance.date": formattedDate } },
                {
                    $project: {
                        _id: 0,
                        uid: 1,
                        status: "$attendance.status",
                        date: "$attendance.date"
                    }
                }
            ]).toArray();

            // Map attendance data for quick lookup
            const attendanceMap = {};
            attendanceData.forEach(record => {
                attendanceMap[record.uid] = record.status;
            });

            console.log(attendanceMap);

            // Combine student data with attendance info
            const combinedData = students.map(student => ({
                fname: student.fname,
                sname: student.sname,
                uid: student.uid,
                status: attendanceMap[student.uid] || "absent",  // Mark absent if no record found
                date: formattedDate
            }));

            // return res.send({ date, attendanceData: combinedData });
            _id = new ObjectId(req.session.user.refId)
            user = await db.collection(`${req.session.user.role}s`).findOne({ "_id": _id })
            user.uname = req.session.user.uname
            user.role = req.session.user.role
            console.log(user)
            return res.render('attendance/viewTeacher', { date, attendanceData: combinedData, user: user })
        } catch (error) {
            console.error("Error fetching attendance:", error);
            return res.status(500).send("Internal Server Error");
        }
    } else {
        return res.status(403).send("Not authorized");
    }
});
app.get("/attendance", isAuthenticated, async (req, res) => {
    if (req.session.user.role === 'teacher') {
        res.render("attendance/calendar")
    }
    if (req.session.user.role === 'student') {
        res.render("attendance/student")
    }
});
app.get("/attendance/slide", isAuthenticated, async (req, res) => {
    if (req.session.user.role === 'teacher') {
        const today = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format

        // Check if attendance for today has already been marked
        const attendanceExists = await db.collection("students").findOne({ "attendance.date": new Date(today) });
        _id = new ObjectId(req.session.user.refId)
        user = await db.collection(`${req.session.user.role}s`).findOne({ "_id": _id })
        user.uname = req.session.user.uname
        user.role = req.session.user.role
        console.log(attendanceExists)
        const students = await db.collection("students").find({ 'std': '6' }).toArray();

        return res.render("attendance/teacher", { students, user: user });
        //    return res.render("attendance/calendar");
    }
    else if (req.session.user.role === 'student') {
        return res.render("attendance/student");
    }
    else {
        return res.status(403).send("Not found");
    }
});
app.get("/attendance/image", isAuthenticated, async (req, res) => {
    res.render("attendance/imageAttendance")
});
app.post("/attendance/imageResultView", attendanceFile.single("image"), isAuthenticated, async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
    }

    try {
        // Create FormData for Flask
        const formData = new FormData();
        formData.append("image", req.file.buffer, { filename: req.file.originalname });

        // Send file to Flask API
        const response = await axios.post("http://127.0.0.1:5000/recognize", formData, {
            headers: formData.getHeaders(),
        });

        const { inference_time, recognized_faces } = response.data; // Extract recognized UIDs

        try {
            const studentsCollection = db.collection('students');
            const std = "6"; // Change this dynamically if needed

            // Fetch all students of the given class
            const students = await studentsCollection.find({ std }).toArray();

            // Prepare attendanceData array with names
            const attendanceData = students.map(student => ({
                uid: student.uid,
                name: `${student.fname} ${student.sname}`, // Concatenating first and surname
                status: recognized_faces.includes(student.uid) ? "present" : "absent"
            }));

            const { date } = req.body;

            if (!date) {
                return res.status(400).send("Date is required");
            }

            // Format date to ensure it's set to 00:00:00 UTC
            const formattedDate = new Date(date);
            formattedDate.setUTCHours(0, 0, 0, 0);

            res.render("attendance/viewImageResult", { date: formattedDate, attendanceData });
            // res.send(attendanceData)

            // res.send({ attendanceData });

            // const updateResponse = await fetch('http://localhost:3000/attendance/mark/', {
            //     method: 'POST',
            //     headers: { 'Content-Type': 'application/json' },
            //     body: JSON.stringify({
            //         date: formattedDate, // Use current date
            //         std,
            //         attendance: attendanceData
            //     })
            // });

            // if (!updateResponse.ok) throw new Error('Failed to update attendance');

            // res.status(200).send(updateResponse);


        } catch (error) {
            console.error("Error sending image to Flask:", error);
            res.status(500).json({ error: "Face recognition failed" });
        }

        // Call /attendance/mark to update attendance


    } catch (err) {
        console.error('Error processing attendance:', err);
        res.status(500).send('Error processing attendance');
    }

});
app.get("/attendance/getData", isAuthenticated, async (req, res) => {
    try {
        // Assume `req.session.user.refId` contains the MongoDB ObjectId (as string) from the session
        const studentId = new ObjectId(req.session.user.refId);  // Convert session ID to ObjectId

        // First, fetch the uid using the ObjectId
        const student = await db.collection("students").findOne({ _id: studentId });

        if (student) {
            const uid = student.uid;  // Retrieve the uid from the student document

            // Now, run the aggregation query using the dynamic `uid`
            const attendanceData = await db.collection("students").aggregate([
                {
                    $match: { uid: uid }  // Match by the dynamic `uid` field
                },
                {
                    $unwind: "$attendance"  // Unwind the attendance array
                },
                {
                    $project: {  // Project only the relevant fields
                        day: { $dayOfMonth: "$attendance.date" }, // Get the day of the month
                        status: "$attendance.status",  // Get the attendance status
                        _id: 0  // Exclude the _id field from the result
                    }
                }
            ]).toArray();

            console.log('Attendance Data:', attendanceData);
            const formattedData = {};
            attendanceData.forEach(record => {
                formattedData[record.day] = record.status;
            });
            res.json(formattedData);
        } else {
            console.log('Student not found');
            res.status(404).json({ error: 'Student not found' });
        }

    } catch (error) {
        console.error('Error fetching attendance:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
})
app.get("/notice-board", isAuthenticated, async (req, res) => {
    const noticeData = await db.collection('notices').find().toArray()

    res.render("notice/view", { notices: noticeData })
})

app.get("/homework", isAuthenticated, async (req, res) => {
    // res.send(req.session.user)
    // const homeworks = await db.collection("homeworks").find().toArray();

    const studentId = req.session.userId; // Get logged-in student ID

    const homeworks = await db.collection("homeworks").aggregate([
        {
            $lookup: {
                from: "homework-submissions", // Join with submissions collection
                let: { hwId: "$_id" }, // Pass homework _id to use in pipeline
                pipeline: [
                    {
                        $match: {
                            $expr: { $eq: ["$homeworkId", "$$hwId"] }, // Match homework ID
                            studentId: studentId // Match student ID
                        }
                    }
                ],
                as: "submission"
            }
        },
        {
            $addFields: {
                status: {
                    $cond: {
                        if: { $gt: [{ $size: "$submission" }, 0] }, // If submission exists
                        then: "Submitted",
                        else: "Pending"
                    }
                }
            }
        },
        {
            $project: {
                _id: 1,
                title: 1,
                description: 1,
                dueDate: 1,
                status: 1 // Include the new status field
            }
        }
    ]).toArray();
    // res.send(`homework/${req.session.user.role}`)
    res.render(`homework/${req.session.user.role}`, { homeworks });
})

app.get("/homework/submit/:id", isAuthenticated, async (req, res) => {
    _id = new ObjectId(req.params.id)
    hw = await db.collection('homeworks').findOne({ "_id": _id });
    res.render("homework/submit", { hw })
})

app.post("/homework/submit", uploadHomework.array('files', 10), isAuthenticated, async (req, res) => {
    const studentId = req.session.user.refId;  // Get student ID from session
    const homeworkId = req.body.id; // Get homework ID from URL
    // const filePath = `/homeworks/${req.files.filename}`; // Get file path
    // console.log(req.body)
    // return res.json(req.body)


    // Check if files were uploaded
    if (!req.files || req.files.length === 0) {
        return res.status(400).send("No files uploaded.");
    }

    // Extract file paths from uploaded files
    const filePaths = req.files.map(file => `/homework_submissions/${file.filename}`);

    const submissionData = {
        studentId: studentId,
        homeworkId: homeworkId,
        fileUrls: filePaths, // Store file URLs as an array
        submittedAt: new Date()
    };

    // Check if submission already exists for this student & homework
    const existingSubmission = await db.collection("homework-submissions").findOne({
        studentId: studentId,
        homeworkId: homeworkId
    });

    if (existingSubmission) {
        // Update existing submission (overwrite previous files)
        await db.collection("homework-submissions").updateOne(
            { studentId: studentId, homeworkId: homeworkId },
            { $set: submissionData }
        );
    } else {
        // Insert new submission
        await db.collection("homework-submissions").insertOne(submissionData);
    }

    res.redirect("/homework"); // Redirect after submission
})

app.post("/homework/add", isAuthenticated, uploadHomework.array('files', 10), async (req, res) => {
    let fileupld = false;
    let fileUrls = [];
    if (req.files.length != 0) {
        fileupld = true;
        fileUrls = req.files.map(file => `/homeworks/${file.filename}`);
    }
    _id = new ObjectId(req.session.user.refId)
    const teacherData = await db.collection('teachers').findOne({ "_id": _id })
    console.log(teacherData);
    const teacher = {
        fname: teacherData.fname,
        sname: teacherData.sname,
    }
    const data = {
        title: req.body.title,
        date: req.body.date,
        details: req.body.details,
        teacher: teacher,
        files: fileUrls,
        fileupld: fileupld
    }
    db.collection('homeworks').insertOne(data);
    res.redirect("/homework/");
})

app.get("/homework/review/:id", isAuthenticated, async (req, res) => {
    _id = new ObjectId(req.params.id)
    hw_submit_data = await db.collection('homework-submissions').find({ "homeworkId": req.params.id }).toArray()
    hw_data = await db.collection('homeworks').findOne({ "_id": _id })

    data = {hw_submit_data, hw_data}
    console.log(data)
    res.render("homework/review", { data });
})
app.get("/test/aptitude", isAuthenticated, async (req, res) => {
    res.render("aptitudeTest");
})





// *****************************************************************************

//************* ADMIN routes */
// {
app.get('/admin', isAuthenticated, (req, res) => {
    res.render('admin/index')
})
app.get('/admin/login', (req, res) => {
    console.log(req)
    const errorMessage = req.flash('error')[0] || 'hidden'; // hidden -> tailwind class to hide element
    const username = req.flash('uname')[0] || '';
    res.render("admin/login", { error: errorMessage, uname: username });
})

app.post("/admin/login", async (req, res) => {
    console.log(req.body)
    try {
        const { uname, password } = req.body;

        const user = await db.collection("admins").findOne({ uname });

        if (!user || !(await bcrypt.compare(password, user.password))) {
            req.flash('error', 'block'); // block -> tailwind class to show element
            req.flash('uname', uname);
            return res.redirect("/admin/login");
        }

        req.session.user = { id: user._id, uname: user.uname, role: "admin" };
        res.redirect("/admin/");
    } catch (error) {
        console.error(error);
        res.status(500).send("Internal Server Error");
    }
});

app.get('/admin/student', isAuthenticated, async (req, res) => {
    error = req.session.error || "hidden"
    formData = req.session.formData || {};
    req.session.error = 'hidden';
    req.session.formData = null;

    const students = await db.collection("students").find({ 'std': '6' }).toArray();

    res.render("admin/student", { error: error, formData: formData, students })
});

app.post('/admin/add/student', isAuthenticated, async (req, res) => {
    const uid = `S${req.body.fname.substring(0, 2).toUpperCase()}${req.body.mnum1.substring(0, 4)}${req.body.sname.substring(0, 2).toUpperCase()}`;

    const student = await db.collection("students").findOne({ uid });
    if (student) {
        req.session.error = "block";
        req.session.formData = req.body;
        return res.redirect("/admin/student");
    }
    let newStudent = req.body;
    newStudent.uid = uid;
    const studentResult = await db.collection("students").insertOne(newStudent);

    const username = await newStudent.mnum1;
    const password = await bcrypt.hash(username.toString(), 10);

    const user = {
        uname: username,
        password: password,
        role: "student",
        refId: studentResult.insertedId
    };


    db.collection("users").insertOne(user);
    return res.redirect("/admin/student");
});

app.get('/admin/teacher', isAuthenticated, async (req, res) => {
    error = req.session.error || "hidden"
    formData = req.session.formData || {};
    req.session.error = 'hidden';
    req.session.formData = null;

    const teachers = await db.collection("teachers").find().toArray();

    res.render("admin/teachers", { error: error, formData: formData, teachers })
});

app.post('/admin/add/teacher', isAuthenticated, async (req, res) => {

    const uid = `S${req.body.fname.substring(0, 2).toUpperCase()}${req.body.mnum.substring(0, 4)}${req.body.sname.substring(0, 2).toUpperCase()}`;

    const teacher = await db.collection("teacher").findOne({ uid });
    if (teacher) {
        req.session.error = "block";
        req.session.formData = req.body;
        return res.redirect("/admin/teacher");
    }
    let newteacher = req.body;
    newteacher.uid = uid;
    const newteacherResult = await db.collection("teachers").insertOne(newteacher);

    const username = await newteacher.mnum;
    const password = await bcrypt.hash(username.toString(), 10);

    const user = {
        uname: username,
        password: password,
        role: "teacher",
        refId: newteacherResult.insertedId
    };


    db.collection("users").insertOne(user);
    return res.redirect("/admin/teacher");
});

app.post("/admin/delete/teacher", isAuthenticated, async (req, res) => {
    const uid = req.body.uid;
    await db.collection("teachers").deleteOne({ 'uid': uid })
    return res.redirect("/admin/teacher")
});
app.post("/admin/delete/student", isAuthenticated, async (req, res) => {
    const uid = req.body.uid;
    await db.collection("students").deleteOne({ 'uid': uid })
    return res.redirect("/admin/student")
});

app.get("/admin/add-random-student", isAuthenticated, async (req, res) => {
    try {
        const fname = faker.person.firstName();
        const sname = faker.person.lastName();
        const mnum1 = faker.string.numeric(10);

        // UID Format: [first 2 letters of fname] + [first 4 digits of mnum1] + [first 2 letters of sname]
        const uid = `S${fname.substring(0, 2).toUpperCase()}${mnum1.substring(0, 4)}${sname.substring(0, 2).toUpperCase()}`;

        const student = {
            fname,
            sname,
            fathername: faker.person.firstName(),
            mothername: faker.person.firstName(),
            uid,
            // std: faker.number.int({ min: 5, max: 12 }),
            std: '6',
            address: faker.location.country(),
            mnum1,
            mnum2: faker.string.numeric(10)
        };

        const result = await db.collection("students").insertOne(student);
        const username = student.mnum1;
        const password = await bcrypt.hash(username.toString(), 10);

        const user = {
            uname: username,
            password: password,
            role: "student",
            refId: result.insertedId
        };


        db.collection("users").insertOne(user);
        res.status(201).send(`Student added with ID: ${result.insertedId}`);
    } catch (error) {
        console.error("Error adding student:", error);
        res.status(500).send("Failed to add student.");
    }
});

app.get("/admin/notice/add", isAuthenticated, (req, res) => {
    res.render('notice/add');
})

app.post("/admin/notice/add", uploadNotice.single('noticeFile'), async (req, res) => {
    let fileupld = false;
    let fileUrl = ""
    if (req.file) {
        fileUrl = `/notices/${req.file.filename}`;
        fileupld = true;
    }

    const data = {
        title: req.body.title,
        date: req.body.date,
        details: req.body.details,
        fileUpld: fileupld,
        fileUrl: fileUrl
    }

    db.collection('notices').insertOne(data)
    res.redirect("/admin/notice/add")
})

app.get('/admin/notice/view', isAuthenticated, async (req, res) => {
    const noticeData = await db.collection('notices').find().toArray()

    res.render("notice/view", { notices: noticeData })
})




app.get("/admin/logout", isAuthenticated, (req, res) => {
    req.session.destroy(() => {
        res.redirect("/admin/login");
    });
});
// }
// ************************************************


app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`)
})
