const express = require('express');
const socket = require('socket.io');
const { ExpressPeerServer } = require('peer');
const groupCallHandler = require('./groupCallHandler');
const { v4: uuidv4 } = require('uuid');
require("dotenv").config()
const PORT = 5000;

const app = express();
const cors = require("cors");
app.use(cors());
const mysql = require("mysql")


const  DB_HOST = 'database-1.cwfqyavvsx85.ap-south-1.rds.amazonaws.com'
const  DB_USER = 'admin'
const  DB_PASSWORD = 'root1234'
const  DB_DATABASE = 'userDB'
const  DB_PORT = 3306

const db = mysql.createPool({
   connectionLimit: 100,
   host: DB_HOST,       
   user: DB_USER,         
   password: DB_PASSWORD,  
   database: DB_DATABASE,     
   port: DB_PORT             
})

const server = app.listen(PORT, () => {
  console.log(`server is listening on port ${PORT}`);
  console.log(`http://localhost:${PORT}`);
});

db.getConnection( (err, connection)=> {
  if (err) throw (err)
  console.log ("DB connected successful: " + connection.threadId)
})

const peerServer = ExpressPeerServer(server, {
  debug: true
});

app.use('/peerjs', peerServer);

groupCallHandler.createPeerServerListeners(peerServer);

const io = socket(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

let peers = [];
let groupCallRooms = [];

const broadcastEventTypes = {
  ACTIVE_USERS: 'ACTIVE_USERS',
  GROUP_CALL_ROOMS: 'GROUP_CALL_ROOMS',
  Remove_CALL_ANS: 'Remove_CALL_ANS'
};

io.on('connection', (socket) => {
  socket.emit('connection', null);
  console.log('new user connected');
  console.log(socket.id);

  socket.on('register-new-user', (data) => {
    peers.push({
      username: data.username,
      usertype: data.usertype,
      socketId: data.socketId
    });
    console.log('registered new user');
    console.log(data);

    io.sockets.emit('broadcast', {
      event: broadcastEventTypes.ACTIVE_USERS,
      activeUsers: peers
    });

    io.sockets.emit('broadcast', {
      event: broadcastEventTypes.GROUP_CALL_ROOMS,
      groupCallRooms
    });
  });

  socket.on('disconnect', () => {
    console.log('user disconnected');
    peers = peers.filter(peer => peer.socketId !== socket.id);
    io.sockets.emit('broadcast', {
      event: broadcastEventTypes.ACTIVE_USERS,
      activeUsers: peers
    });

    groupCallRooms = groupCallRooms.filter(room => room.socketId !== socket.id);
    io.sockets.emit('broadcast', {
      event: broadcastEventTypes.GROUP_CALL_ROOMS,
      groupCallRooms
    });
  });

  // listeners related with direct call

  socket.on('pre-offer', (data) => {
    console.log('pre-offer handled');
    io.to(data.callee.socketId).emit('pre-offer', {
      callerUsername: data.caller.username,
      callerSocketId: socket.id
    });
  });

  socket.on('pre-offer-answer', (data) => {
    console.log('handling pre offer answer');
    io.to(data.callerSocketId).emit('pre-offer-answer', {
      answer: data.answer
    });
  });

  socket.on('webRTC-offer', (data) => {
    console.log('handling webRTC offer');
    io.to(data.calleeSocketId).emit('webRTC-offer', {
      offer: data.offer
    });
  });

  socket.on('webRTC-answer', (data) => {
    console.log('handling webRTC answer');
    io.to(data.callerSocketId).emit('webRTC-answer', {
      answer: data.answer
    });
  });

  socket.on('webRTC-candidate', (data) => {
    console.log('handling ice candidate');
    io.to(data.connectedUserSocketId).emit('webRTC-candidate', {
      candidate: data.candidate
    });
  });

  socket.on('user-hanged-up', (data) => {
    io.to(data.connectedUserSocketId).emit('user-hanged-up');
  });

  // listeners related with group call
  socket.on('group-call-register', (data) => {
    const roomId = uuidv4();
    socket.join(roomId);

    const newGroupCallRoom = {
      peerId: data.peerId,
      hostName: data.username,
      socketId: socket.id,
      roomId: roomId
    };

    groupCallRooms.push(newGroupCallRoom);
    io.sockets.emit('broadcast', {
      event: broadcastEventTypes.GROUP_CALL_ROOMS,
      groupCallRooms
    });
  });

  socket.on('group-call-join-request', (data) => {
    io.to(data.roomId).emit('group-call-join-request', {
      peerId: data.peerId,
      streamId: data.streamId
    });
    socket.join(data.roomId);

    // below logic to remove the answer notification from all
    // groupCallRooms = groupCallRooms.filter(room => room.socketId !== data.hostSocketId);
    console.log("$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$ join group call click reqest");
    console.log(groupCallRooms);
    // console.log(data);
    // io.sockets.emit('broadcast', {
    //   event: broadcastEventTypes.Remove_CALL_ANS,
    //   groupCallRooms
    // });

  });

  socket.on('group-call-user-left', (data) => {
    socket.leave(data.roomId);
    console.log("user");
    console.log(data)

    io.to(data.roomId).emit('group-call-user-left', {
      streamId: data.streamId
    });

    // the below broadcast is done to remove from group list

    groupCallRooms = groupCallRooms.filter(room => room.roomId !== data.roomId);
    
    console.log("$$$$$$$$$$$$$$$$$");
    console.log(groupCallRooms);
    console.log(data.peerId);
    console.log(data);
    
    io.sockets.emit('broadcast', {
      event: broadcastEventTypes.GROUP_CALL_ROOMS,
      groupCallRooms
    });
  });

  socket.on('group-call-closed-by-host', (data) => {
    groupCallRooms = groupCallRooms.filter(room => room.peerId !== data.peerId);
    console.log("Host");
    console.log(groupCallRooms);
    console.log(data);

    io.sockets.emit('broadcast', {
      event: broadcastEventTypes.GROUP_CALL_ROOMS,
      groupCallRooms
    });
  });
});



// DB APIS

const bcrypt = require("bcrypt")
app.use(express.json())
app.post("/createUser", async (req,res) => {
const user = req.body.name;
const hashedPassword = await bcrypt.hash(req.body.password,10);
const email = req.body.email;
const isAdmin = req.body.isAdmin;
db.getConnection( async (err, connection) => {
 if (err) throw (err)
 const sqlSearch = "SELECT * FROM usertable WHERE userId = ?"
 const search_query = mysql.format(sqlSearch,[user])
 const sqlInsert = "INSERT INTO usertable VALUES (0,?,?,?,?)"
 const insert_query = mysql.format(sqlInsert,[user, hashedPassword,isAdmin,email])
 await connection.query (search_query, async (err, result) => {
  if (err) throw (err)
  console.log("------> Search Results")
  console.log(result.length)
  if (result.length != 0) {
   connection.release()
   console.log("------> User already exists")
   res.sendStatus(409) 
  } 
  else {
   await connection.query (insert_query, (err, result)=> {
   connection.release()
   if (err) throw (err)
   console.log ("--------> Created new User")
   console.log(result.insertId)
    res.writeHead(200, {"Content-Type": "application/json"});
    var json = JSON.stringify({ 
      created: true, 
    });
    res.end(json);
  })
 }
}) 
}) 
}) 


//LOGIN (AUTHENTICATE USER)
app.post("/login", (req, res)=> {
    const user = req.body.name
    const password = req.body.password
    db.getConnection ( async (err, connection)=> {
     if (err) throw (err)
     const sqlSearch = "Select * from usertable where userName = ?"
     const search_query = mysql.format(sqlSearch,[user])
     await connection.query (search_query, async (err, result) => {
      connection.release()
      
      if (err) throw (err)
      if (result.length == 0) {
       console.log("--------> User does not exist")
          // res.sendStatus(404)
          res.writeHead(404, {"Content-Type": "application/json"});
          var json = JSON.stringify({ 
            result: "User does not exist", 
          });
          res.end(json);
      } 
      else {
         const hashedPassword = result[0].password
         //get the hashedPassword from result
        if (await bcrypt.compare(password, hashedPassword)) {
        console.log("---------> Login Successful")
        // res.send(`${user} is logged in!`)
        res.writeHead(200, {"Content-Type": "application/json"});
          var json = JSON.stringify({ 
            result: `${user} is logged in!`,
            details:result
          });
          res.end(json);
        } 
        else {
        console.log("---------> Password Incorrect")
        // res.send("Password incorrect!");
        res.writeHead(403, {"Content-Type": "application/json"});
          var json = JSON.stringify({ 
            result: "Password incorrect!", 
          });
          res.end(json);
        } 
      }
     }) 
    }) 
    }) 


    //Delete user
    app.post("/deleteUser", async (req,res) => {
        const user = req.body.name;
        db.getConnection( async (err, connection) => {
         if (err) throw (err)
         const sqlSearch = "SELECT * FROM usertable WHERE userName = ?"
         const search_query = mysql.format(sqlSearch,[user])
         const sqlDelete = "DELETE FROM usertable WHERE  userName = ?"
         const delete_query = mysql.format(sqlDelete,[user])
         await connection.query (search_query, async (err, result) => {
          if (err) throw (err)
          console.log("------> Search Results")
          console.log(result.length)
          if (result.length == 0) {
           connection.release()
           console.log("------> User Does not exists")
          //  res.sendStatus(409)
           res.writeHead(409, {"Content-Type": "application/json"});
            var json = JSON.stringify({ 
              result: "User does not exixts", 
            });
            res.end(json);
          } 
          else {
           await connection.query (delete_query, (err, result)=> {
           connection.release()
           if (err) throw (err)
           console.log ("-------->User Deleted")
           console.log(result.insertId)
          //  res.sendStatus(201);
           res.writeHead(200, {"Content-Type": "application/json"});
            var json = JSON.stringify({ 
              result: true, 
            });
            res.end(json);
          })
         }
        }) 
      }) 
    }) 

       //Update password
       app.post("/updateUserPassword", async (req,res) => {
        console.log("------> Entred update user")

        const user = req.body.name;
        const hashedPassword = await bcrypt.hash(req.body.password,10);
        console.log("------> Entred update user",hashedPassword)

        db.getConnection( async (err, connection) => {
         if (err) throw (err)
         const sqlUpdate = "UPDATE usertable SET password = ? Where  userName = ?"
         const update_query = mysql.format(sqlUpdate,[hashedPassword,user])
        await connection.query (update_query, (err, result)=> {
           connection.release()
           if (err) throw (err)
           console.log ("--------> password update")
           console.log(result.insertId)
           res.sendStatus(201)
          })
         })    
        }) 

        app.post("/updateUser", async (req,res) => {
            const user = req.body.name;
            const hashedPassword = await bcrypt.hash(req.body.password,10);
            const email = req.body.email;
            const isAdmin = req.body.isAdmin;
            db.getConnection( async (err, connection) => {
             if (err) throw (err)
             const sqlInsert = "UPDATE usertable SET  password = ? , emailAddress = ? , isAdmin = ? Where  userName = ?"
             const insert_query = mysql.format(sqlInsert,[hashedPassword,email,isAdmin,user])
               await connection.query (insert_query, (err, result)=> {
               connection.release()
               if (err) throw (err)
               console.log ("--------> Created new User")
               console.log(result.insertId)
              //  res.sendStatus(201);
               res.writeHead(200, {"Content-Type": "application/json"});
                var json = JSON.stringify({ 
                  result: "Updated Successful", 
                });
                res.end(json);
              })
             })
            }) 

        app.get("/getAllUsers", async (req,res) => {
            db.getConnection( async (err, connection) => {
             if (err) throw (err)
             const sqlSearch = "SELECT * FROM usertable"
             const search_query = mysql.format(sqlSearch,[])
             await connection.query (search_query, async (err, result) => {
              if (err) throw (err)
                            console.log(result)
                           res.send(result)
            }) 
            }) 
            }) 

            app.post("/createAuditReport", async (req,res) => {
              const callStartTime = req.body.callStartTime;
              const operatorName = req.body.operatorName;;
              const callEndTime = req.body.callEndTime;
              const reason = req.body.reason;;
              const callOrigin = req.body.callOrigin;
              const today = new Date(callStartTime);
              const endDate = new Date(callEndTime);
              const minutes = parseInt(Math.abs(endDate.getTime() - today.getTime()) / (1000 * 60) % 60);
              const seconds = parseInt(Math.abs(endDate.getTime() - today.getTime()) / (1000) % 60); 
              const callDuration = minutes + ' Minute ' + seconds + ' Seconds'
              db.getConnection( async (err, connection) => {
               if (err) throw (err)
               const sqlInsert = "INSERT INTO auditReports VALUES (0,?,?,?,?,?,?)"
               const insert_query = mysql.format(sqlInsert,[callStartTime, operatorName,callDuration,callEndTime,callOrigin,reason])
                 await connection.query (insert_query, (err, result)=> {
                 connection.release()
                 if (err) throw (err)
                 console.log ("--------> Created new User")
                 console.log(result.insertId)
                 res.writeHead(200, {"Content-Type": "application/json"});
                  var json = JSON.stringify({ 
                   created: true, 
                    });
                 res.end(json);
             
              }) 
          }) 
      })


      app.get("/getAuditReport", async (req,res) => {
        db.getConnection( async (err, connection) => {
         if (err) throw (err)
         const sqlSearch = "SELECT * FROM auditReports"
         const search_query = mysql.format(sqlSearch,[])
         await connection.query (search_query, async (err, result) => {
          if (err) throw (err)
                        console.log(result)
                       res.send(result)
        }) 
        }) 
    });
    
    app.post("/forgotPassword", async (req,res) => {
      console.log("------> Entred update user")
      var password = generator.generate({
        length: 10,
        numbers: true,
      });
      const user = req.body.name;
      const email = req.body.email;
      const hashedPassword = await bcrypt.hash(password,10);
      db.getConnection( async (err, connection) => {

      const sqlSearch = "SELECT * FROM usertable WHERE userName = ? and emailAddress = ?"
      const search_query = mysql.format(sqlSearch,[user,email])
      const sqlUpdate = "UPDATE usertable SET password = ? Where  userName = ? and emailAddress = ?"
      const update_query = mysql.format(sqlUpdate,[hashedPassword,user,email])
      await connection.query (search_query, async (err, result) => {
      if (err) throw (err)
      console.log("------> Search Results")
      console.log(result.length)
      if (result.length == 0) {
      connection.release()
      console.log("------> User does not exists")
      res.sendStatus(409) 
       } 
       else {
          await connection.query (update_query, (err, result)=> {
         connection.release()
          if (err) throw (err)
        console.log ("--------> Password Updated")
        sendmail({
          from: 'test@finra.org',
          to: 'ahmedhassain95@gmail.com',
          subject: 'Password Reset Complete',
          html: 'Password has been reset to' 
        }, function (err, reply) {
          console.log(err && err.stack)
          console.dir(reply)
        })
       console.log(result.insertId)
      res.writeHead(200, {"Content-Type": "application/json"});
      var json = JSON.stringify({ 
      created: true, 
       });
       res.end(json);
       })
      }                  
      })    
      }) 
    })
