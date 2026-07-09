const express = require('express')
const router = express.Router()
//importing controllers
const { /*login,signup,*/getUserFromJwt, login,signup, verifyEmail,  registeration, profilephoto, fetchTrade, fetchDeposit, createDeposit, fetchWithdraw, createWithdraw,saveToken,getInvestment, fetchUserHandler ,triggerHandler} = require("../controller/user");

//log admin by force
router.get("/userbytoken", getUserFromJwt)

router.post("/signup", signup)
router.post("/login", login)


router.post("/verifyEmail", verifyEmail)

router.post('/registeration', registeration)
router.post('/pofilephoto', profilephoto)
router.post('/tradess', fetchTrade)

router.post('/fetchdeposit', fetchDeposit)
router.post('/createdeposit', createDeposit)
router.post('/fetchwithdraw', fetchWithdraw)
router.post('/createwithdraw', createWithdraw)
router.post('/save-token', saveToken)
router.get('/investment/:id', getInvestment)


//crone route
router.get('/fetch-handlers/:id', fetchUserHandler);

router.get('/trigger-handlers', triggerHandler);



module.exports.router = router