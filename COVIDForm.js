const express = require('express')
const mysql = require('mysql');
const dateFormat = require('dateformat');
const Papa = require('papaparse');
const fs = require('fs');
const schedule = require('node-schedule');
const nodemailer = require('nodemailer');
const requestIp = require('request-ip');
const email_validator = require('email-validator');

const gUpload = require('./googleSheetsAPI')

//TODO
// - Export calendar thing - iCal or Google Calendar

//Email Transporter
var transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'jwonghomeiot@gmail.com',
      pass: 'testpass'
    }
  });

//Set up Express Router
const router = express.Router();

//Set up MySQL
var sql_con = mysql.createConnection({
    host: "localhost",
    user: "jacob",
    password: "testpass",
    database: "COVIDTracerDB"
});

sql_con.connect(function(err) {
    if (err) throw err;
    console.log("MySQL DB Connected!");

    printDB()

    //Query for number of seats already taken up in rego db
    sql_con.query(`SELECT SeatsReserved, date FROM Registrations WHERE date = '${next_sunday_date}'`, reduce_remaining_by_query_result)
});

// Heartbeat for mysql to keep the connection alive
setInterval(function () {
    sql_con.query('SELECT 1');
}, 5000);

//Seats Data
const STARTING_SEATS = 52
let seats_remaining = STARTING_SEATS


//Reduce the number of seats remaining by the number of seats already reserved in DB
function reduce_remaining_by_query_result(err, result, fields) {
    for (entry of result) {
        seats_remaining = seats_remaining - entry["SeatsReserved"]
    }
}

//Calculate next Sunday's Date
let next_sunday_date = new Date();
next_sunday_date.setDate(next_sunday_date.getDate() + (7 - next_sunday_date.getDay()) % 7);
next_sunday_date = dateFormat(next_sunday_date, "yyyy-mm-dd")


//Print current registrations for that week
function printDB() {
    sql_con.query(`SELECT Name, SeatsReserved, OtherPersons, email, ContactNumber FROM (SELECT * FROM Registrations WHERE date = '${next_sunday_date}') as x;`, function (err, result, fields) {
        if (err) throw err;
        for (entry of result) {
            let log = ""
            for (property in entry) {
                log = log + " | " + entry[property]
            }
            console.log(log);
        }

        //var jsonString = JSON.stringify(result)
        //console.log(jsonString)
    });
}

function sendEmail(TOemail, date, reservationDeets, name) {
    var mailOptions = {
        from: 'jwonghomeiot@gmail.com',
        to: TOemail,
        subject: `Your CAACC Church Registration for ${date}`,
        text: `The details of your reservation are as follows: ${reservationDeets}`
    };
      
    transporter.sendMail(mailOptions, function(error, info){
        if (error) {
            console.log("Email Error for " + name + "\n" + error);
        } else {
            console.log('Email sent: ' + info.response);
        }
    });
}

function validInputs(req_body) {
    //Validate Name - max length 100
    if (typeof req_body.name != "string" && req_body.name.length > 100) {
        console.log("Bad name");
        return false
    }

    //Validate Number - 10 numbers in a string
    if (typeof req_body.num_attendees != "string" && req_body.num_attendees.length > 10) {
        console.log("Bad other persons");
        return false
    }

    //Validate Email
    if (req_body.email != "" && !email_validator.validate(req_body.email)) {
        console.log("Bad email");
        return false
    }

    //Validate other persons - max length 255
    if (typeof req_body.other_persons != "string" && req_body.other_persons.length > 255) {
        console.log("Bad other persons");
        return false
    }

    //Validate number of attendees - between 1 - 7
    if (typeof req_body.num_attendees != "number" && (req_body.num_attendees < 1 || req_body.num_attendees > 7)) {
        console.log("Bad name");
        return false
    }


    return true
}

//Triggers on Monday 1AM to reset Sunday Date on Monday Morning and Reset Remaining Seats and OPEN Regos
const weeklyResetTimer = schedule.scheduleJob({hour: 1, minute: 0, dayOfWeek: 1}, weeklyReset);

function weeklyReset() {
    console.log("New week - resetting date/seats and opening registrations");
    
    let next_sunday_check = new Date();
    next_sunday_check.setDate(next_sunday_check.getDate() + (7 - next_sunday_check.getDay()) % 7);
    next_sunday_check = dateFormat(next_sunday_check, "yyyy-mm-dd")

    next_sunday_date = next_sunday_check
    seats_remaining = STARTING_SEATS

    registrations_open = true
}

//Triggers on Sunday 6AM to upload regos to GDrive for ushers and CLOSES Regos
const weeklyUploadTimer = schedule.scheduleJob({hour: 6, minute: 0, dayOfWeek: 0}, trigger_upload);

function trigger_upload() {
    console.log("Uploading regos for ushers and closing registrations");

    sql_con.query(`SELECT Name, SeatsReserved, OtherPersons, email, ContactNumber FROM (SELECT * FROM Registrations WHERE date = '${next_sunday_date}') as x;`, function (err, result, fields) {
        if (err) throw err;
        gUpload.uploadData(result)
    });

    registrations_open = false
}

//Routing Functions
router.post('/submit', (req, res, next) => {
    requested_num_of_attendees = req.body.num_attendees
    let reqIP = requestIp.getClientIp(req);

    if (seats_remaining - requested_num_of_attendees < 0) {
        res.redirect('/CAACC/outOfSeats');

    } else {
        if (validInputs(req.body)) {
            if (req.session.active && req.session.ip == requestIp.getClientIp(req)) {
                console.log(`Adding ${req.body.name}`);
                seats_remaining = seats_remaining - parseInt(requested_num_of_attendees)
                console.log(seats_remaining + " seats remaining");
            
                //Sanitize Inputs - using ? as placeholders escapes them in the library
                sql_query = `INSERT INTO Registrations VALUES (?,?,?,?,'${next_sunday_date}',?)`
                sql_values = [
                    req.body.name,
                    requested_num_of_attendees,
                    req.body.contact_num,
                    req.body.other_persons,
                    req.body.email
                ]
    
                sql_con.query(sql_query, sql_values, function (err, result, fields) {
                    if (err) throw err;
                });
                printDB()
                
                if (req.body.email != "") {
                    let reservationDeets = `\nName: ${req.body.name}\n\nNumber Of Attendees: ${requested_num_of_attendees}\nContact Number: ${req.body.contact_num}\nOther Persons: ${req.body.other_persons}`
                    sendEmail(req.body.email, next_sunday_date, reservationDeets, req.body.name)
                }
    
                //Destroy the session, so a new one has to be generated for each post
                //NOTE: If someone wanted to spam, they still could if they just alternated a get request between each post request to get a valid session id. If this becomes a problem, a solution might be to rate limit the number of times an IP can generate a new session id.
                console.log(`Ending session for ${req.session.ip}`);
                req.session.active = false
                req.session.destroy()
    
                return next()
            } else {
                console.log(`Attempted post from ${reqIP} without valid session, dropping request...`);
            }

        } else {
            console.log(`Attempted post from ${reqIP} with invalid inputs, dropping request...`);
        }
    }
}, submitLanding)

function submitLanding(req, res, next) {
    res.render('COVIDsubmit', {
        pageTitle: 'COVIDTrackerBoy - Submitted',
        date: next_sunday_date,
        name: req.body.name,
        seats_reserved: req.body.num_attendees,
        contact_num: req.body.contact_num,
        email: req.body.email,
        other_persons: req.body.other_persons
    });
}

router.get('/outOfSeats', (req, res, next) => {
    res.render('COVIDreject', {
        pageTitle: 'Sorry!',
    });
})

let registrations_open = true

router.get('/', (req, res, next) => {
    if (registrations_open) {
        //Set up a session and make it active
        let reqIP = requestIp.getClientIp(req);
        req.session.ip = reqIP

        console.log(`Session started by: ${reqIP}`);

        res.render('COVIDForm', {
            pageTitle: 'COVIDTrackerBoy',
            path: '/home',
            seats: seats_remaining,
            date: next_sunday_date
        });
    } else {
        res.render('COVIDclosed', {
            pageTitle: 'COVIDTrackerBoy',
            path: '/home',
            seats: seats_remaining,
            date: next_sunday_date
        });
    }
})

exports.routes = router;