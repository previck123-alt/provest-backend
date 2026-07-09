require('dotenv').config();
const { User, Token, Transaction, Trade, Deposit, Admin, Withdraw, Investment, DepositHandler } = require("../database/database");
const mongoose = require("mongoose");
const { sendNotification } = require('../utils/notification');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND);

module.exports.triggerHandler = async (req, res, next) => {
  try {
    const handlers = await DepositHandler.find({
      status: 'active',
    }).populate('user');

    for (const handler of handlers) {
      if (handler.daysLeft > 0) {
        // Reduce daysLeft
        handler.daysLeft -= 1;

        // If time has expired and deposits are incomplete
        if (handler.daysLeft === 0 ) {
          handler.status = 'expired';
        }

        // Update last update time
        handler.lastCountdownUpdate = new Date();

        await handler.save();

        // Calculate deposits remaining based on dailyProfit instead of depositsMade
        const depositsRemaining = handler.totalDepositsRequired - handler.depositAmount;
        const user = handler.user;

        // Send Email Reminder
        const emailHtml = `
          <h2>Alphagainmetrics Deposit Reminder</h2>
          <p>Hello ${user.firstName || user.email},</p>
          <p>You have <strong>${handler.daysLeft}</strong> day(s) left in your deposit schedule.</p>
          <p>Total deposits required: <strong>$${handler.totalDepositsRequired}</strong></p>
          <p>Deposits remaining: <strong>$${depositsRemaining}</strong></p>
          <p>Total deposit made: <strong>$${handler.depositAmount}</strong></p>
          <p>Please complete your deposits before time runs out.</p>
        `;

        await resend.emails.send({
          from: 'Alphagainmetrics@alphagainmetrics.xyz',
          to: user.email,
          subject: 'Deposit Reminder - Alphagainmetrics',
          html: emailHtml
        });

        // Find user's active investment and increment profit
        const investment = await Investment.findOne({
          user: user._id,
          isActive: true
        });

        if (investment) {
          investment.profit += handler.dailyProfit;
          investment.totalProfit += handler.dailyProfit;
          await investment.save();
        }
      }
    }

    return res.status(200).json({
      response: "Deposit handlers processed and users notified successfully."
    });

  } catch (error) {
    console.error("Trigger Handler Error:", error);
    return next({
      status: 500,
      message: error.message || "An error occurred while processing deposit handlers."
    });
  }
};




module.exports.saveToken = async (req, res, next) => {
    let { token, user } = req.body;

    try {
        //search for the user
        let userExist = await User.findOne({ email: user.email });
        if (!userExist) {
            let error = new Error("user not found");
            error.statusCode = 404;  // Unprocessable Entity (Invalid email)
            return next(error);
        }

        userExist.fcmToken = token

        let savedUser = await userExist.save()

        if (!savedUser) {
            let error = new Error("error saving user");
            error.statusCode = 300;  // Unprocessable Entity (Invalid email)
            return next(error);
        }


        // Return success with the user data
        return res.status(200).json({
            response: {
                user: savedUser
            }
        });


    } catch (error) {
        // Log and handle the error
        console.log(error)
        error.message = 'An error occurred during authentication.';
        error.statusCode = 500;  // Internal Server Error
        return next(error);
    }
};


module.exports.getUserFromJwt = async (req, res, next) => {
    try {

        let token = req.headers["header"]

        if (!token) {
            throw new Error("a token is needed ")
        }

        const decodedToken = jwt.verify(token, process.env.SECRET_KEY)

        const user = await User.findOne({ email: decodedToken.email })
        //fetch admin

        const admin = await Admin.find()

        if (!user) {
            return res.status(404).json({
                response: "user has been deleted"
            })
        }

        let fetchTransactions = await Transaction.find({ user: user })


        const notificationPayload = {
            title: 'Welcome Back',
            body: 'Glad to have you back on your dashboard.'
        };

        await sendNotification(user.fcmToken, notificationPayload);

        let investments = await Investment.findOne({ user: user._id })
        console.log({
            user: user,
            transactions: fetchTransactions,
            admin: admin[0],
            investments,
        })

        let tokens = generateAcessToken(user.email)


        return res.status(200).json({
            response: {
                token: tokens,
                expiresIn: '500',
                user: user,
                transactions: fetchTransactions,
                admin: admin[0],
                investments,
            }
        })
    } catch (error) {
        console.log(error)
        error.message = error.message || "an error occured try later"
        return next(error)
    }

}

module.exports.login = async (req, res, next) => {
    let { email, password } = req.body;

    try {
        let userExist = await User.findOne({ email: email });

        if (!userExist) {
            let error = new Error("user is not registered");
            error.statusCode = 404;  // Unprocessable Entity (Invalid email)
            return next(error);
        }

        //check if user has set passcode
        if (userExist.password !== password) {
            let error = new Error("password incorrect");
            error.statusCode = 300;  // Unprocessable Entity (Invalid email)
            return next(error);
        }




        if (!userExist.isEmailVerified) {
            // Generate 4-digit token
            const token = Math.floor(1000 + Math.random() * 9000);

            const authenticateEmailTemplate = (email, token) => {
                return `
            <!DOCTYPE html>
            <html>
            <body>
                <h2>Alphagainmetrics Verification</h2>
                <p>Hello ${email}, your verification code is: <strong>${token}</strong></p>
                <p>If you did not request this, please ignore.</p>
            </body>
            </html>`;
            };
            const emailResponse = await resend.emails.send({
                from: 'Alphagainmetrics@alphagainmetrics.xyz',
                to: email,
                subject: 'Account Verification',
                html: authenticateEmailTemplate(userExist.email, token),
            });
            console.log(emailResponse)

            if (!emailResponse) {
                console.log(error)
                let error = new Error("Email not sent. Email could be invalid");
                error.statusCode = 300;  // Unprocessable Entity (Invalid email)

                return next(error);
            }


            // Save token
            const savedToken = await new Token({
                _id: new mongoose.Types.ObjectId(),
                email,
                token,
            }).save();

            if (!savedToken) {
                let error = new Error("an error occured on the server");
                error.statusCode = 300;  // Unprocessable Entity (Invalid email)
                return next(error);
            }

            return res.status(202).json({
                response: {
                    message: "Verification email sent. User registered.",
                }
            });

        }

        let fetchTransactions = await Transaction.find({ user: userExist })
        let admin = await Admin.find()
        let investments = await Investment.findOne({ user: userExist._id })

        let tokens = generateAcessToken(email)


        // Return success with the user data
        return res.status(200).json({
            response: {
                user: userExist,
                message: "Proceed to other screen",
                token: tokens,
                expiresIn: '500',
                transactions: fetchTransactions,
                admin: admin[0],
                investments
            }
        });

    } catch (error) {
        console.log(error)
        error.message = 'An error occurred during authentication.';
        error.statusCode = 300;  // Internal Server Error
        return next(error);
    }
};





module.exports.signup = async (req, res, next) => {
    const {
        firstName,
        lastName,
        email,
        gender,
        country,
        password,
        accountPackage,
        confirmPassword,
        phone,
        accountPackage: package,
    } = req.body;

    try {
        const userExist = await User.findOne({ email });
        if (userExist) {
            let error = new Error("user is already registered");
            error.statusCode = 303;  // Unprocessable Entity (Invalid email)
            return next(error);
        }

        // Check password match
        if (password !== confirmPassword) {
            let error = new Error("password does not match");
            error.statusCode = 300;  // Unprocessable Entity (Invalid email)
            return next(error);
        }

        // Generate 4-digit token
        const token = Math.floor(1000 + Math.random() * 9000);

        // Try to send email
        const authenticateEmailTemplate = (email, token) => {
            return `
            <!DOCTYPE html>
            <html>
            <body>
                <h2>Alphagainmetrics Verification</h2>
                <p>Hello ${email}, your verification code is: <strong>${token}</strong></p>
                <p>If you did not request this, please ignore.</p>
            </body>
            </html>`;
        };
        const emailResponse = await resend.emails.send({
            from: 'Alphagainmetrics@alphagainmetrics.xyz',
            to: email,
            subject: 'Account Verification',
            html: authenticateEmailTemplate(email, token),
        });

        if (!emailResponse) {
            console.log(error)
            let error = new Error("Email not sent. Email could be invalid");
            error.statusCode = 300;  // Unprocessable Entity (Invalid email)

            return next(error);
        }

        // Save token
        const savedToken = await new Token({
            _id: new mongoose.Types.ObjectId(),
            email,
            token,
        }).save();

        if (!savedToken) {
            let error = new Error("an error occured on the server");
            error.statusCode = 300;  // Unprocessable Entity (Invalid email)
            return next(error);
        }

        // Create and save user (no password hashing)
        const newUser = new User({
            _id: new mongoose.Types.ObjectId(),
            firstName,
            lastName,
            email,
            gender,
            country,
            password,
            accountPackage,
            phone,
            isSetPasscode: false,
            isVerified: false
        });

        let savedUser = await newUser.save();


        const newInvestment = new Investment({
            _id: new mongoose.Types.ObjectId(),
            investmentPlan: package.name,
            user: savedUser
        });

        await newInvestment.save();

        return res.status(200).json({
            response: {
                message: "Verification email sent. User registered.",
            }
        });

    } catch (error) {
        console.log(error)
        error.message = 'An error occurred during registration.';
        error.statusCode = 300;
        return next(error);
    }
};



module.exports.verifyEmail = async (req, res, next) => {
    const { code, email } = req.body;
    console.log("Verify Email Request Body:", req.body);

    try {
        // 1. Validate token
        const tokenExist = await Token.findOne({ code, email });
        if (!tokenExist) {
            const error = new Error("Token expired or invalid.");
            error.statusCode = 400;
            return next(error);
        }

        // 2. Find user
        const user = await User.findOne({ email });
        if (!user) {
            const error = new Error("User not found.");
            error.statusCode = 404;
            return next(error);
        }

        // 3. Mark as verified
        user.isEmailVerified = true;
        await user.save();

        // 4. Delete used token
        await Token.deleteOne({ _id: tokenExist._id });

        // 5. Fetch user data
        const transactions = await Transaction.find({ user: user._id });
        const investments = await Investment.findOne({ user: user._id });
        const admin = await Admin.find();

        // 6. Generate JWT token
        const token = generateAcessToken(user.email);

        // 7. Send welcome email
        const welcomeEmailTemplate = (name) => `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; color: #333; }
                    .container { padding: 20px; border: 1px solid #eee; border-radius: 10px; background: #f9f9f9; }
                    h2 { color: #0d6efd; }
                    p { line-height: 1.6; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h2>Welcome to AlphaGainMetrics, ${name}!</h2>
                    <p>We're excited to have you onboard. Your email has been successfully verified, and your journey with AlphaGainMetrics begins now.</p>
                    <p>Start exploring your investment options and let us help you grow your assets smartly and securely.</p>
                    <p>Feel free to reach out anytime—we're here to support you.</p>
                    <br/>
                    <p>Warm regards,</p>
                    <p><strong>AlphaGainMetrics Team</strong></p>
                </div>
            </body>
            </html>
        `;

        try {
            const emailResponse = await resend.emails.send({
                from: 'Alphagainmetrics@alphagainmetrics.xyz',
                to: email,
                subject: 'Welcome to AlphaGainMetrics!',
                html: welcomeEmailTemplate(user.firstName),
            });

            if (!emailResponse || !emailResponse.id) {
                console.warn("Welcome email failed to send or missing response ID.");
            }
        } catch (emailErr) {
            console.error("Error sending welcome email:", emailErr);
            // Don't fail verification due to email error; just log it
        }

        // 8. Respond with data
        return res.status(200).json({
            response: {
                user,
                message: "Email verified successfully! Welcome email sent.",
                token,
                expiresIn: 500,
                transactions,
                investments,
                admin: admin[0]
            }
        });

    } catch (err) {
        console.error("Error during email verification:", err);
        err.message = 'An error occurred during email verification.';
        err.statusCode = 500;
        return next(err);
    }
};



module.exports.registeration = async (req, res, next) => {
    try {
        let { Nid, country, state, address, passportUrl, email, firstName, lastName } = req.body;

        if (!passportUrl) {
            let error = new Error("passport photo needed");
            return next(error);
        }

        let userExist = await User.findOne({ email: email });
        if (!userExist) {
            let error = new Error("user does not exist");
            return next(error);
        }

        userExist.nid = Nid;
        userExist.country = country;
        userExist.state = state;
        userExist.address = address;
        userExist.passportUrl = passportUrl;
        userExist.infoVerified = true;
        userExist.firstName = firstName;
        userExist.lastName = lastName;

        userExist.kycVerified = 'pending'

        let savedUser = await userExist.save();
        if (!savedUser) {
            let error = new Error("an error occurred");
            return next(error);
        }

        // Send confirmation email
        await resend.emails.send({
            from: 'Alphagainmetrics@alphagainmetrics.xyz',
            to: email,
            subject: 'Profile Registration Completed',
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                  <meta charset="UTF-8" />
                  <title>Alphagainmetrics Registration Success</title>
                  <style>
                    body {
                      font-family: Arial, sans-serif;
                      background-color: #f4f4f4;
                      padding: 0;
                      margin: 0;
                    }
                    .container {
                      background-color: #fff;
                      max-width: 600px;
                      margin: 0 auto;
                      padding: 30px;
                      box-shadow: 0 0 10px rgba(0,0,0,0.1);
                    }
                    h2 {
                      color: #333;
                      text-align: center;
                    }
                    p {
                      color: #555;
                      font-size: 1rem;
                    }
                    .footer {
                      margin-top: 20px;
                      font-size: 0.9rem;
                      text-align: center;
                      color: #777;
                    }
                  </style>
                </head>
                <body>
                  <div class="container">
                    <h2>Alphagainmetrics Registration Complete</h2>
                    <p>Dear ${firstName} ${lastName},</p>
                    <p>Your profile registration on Alphagainmetrics has been successfully completed and verified.</p>
                    <p>You can now access all features that require identity verification.</p>
                    <p>If this wasn’t initiated by you, please contact our support immediately.</p>
                    <div class="footer">
                      <p>Thank you for using Alphagainmetrics.</p>
                    </div>
                  </div>
                </body>
                </html>
            `
        });

        let notification = {
            title: 'Registration Completed',
            body: 'Your profile registration on Alphagainmetrics has been successfully completed and verified'
        };


        await sendNotification(savedUser.fcmToken, notification)

        return res.status(200).json({
            response: 'registered successfully'
        });

    } catch (error) {
        error.message = error.message || "an error occurred, try later";
        return next(error);
    }
};


module.exports.profilephoto = async (req, res, next) => {
    try {

        let { profilePhotoUrl, email } = req.body

        if (!profilePhotoUrl) {
            let error = new Error("profile photo needed")
            return next(error)
        }

        let userExist = await User.findOne({ email: email })
        if (!userExist) {
            let error = new Error("user does not exist")
            return next(error)
        }

        userExist.profilePhotoUrl = profilePhotoUrl
        userExist.photoVerified = true

        let savedUser = await userExist.save()

        let notification = {
            title: 'Profile photo added',
            body: 'Your profile Photo has been successfully added'
        };


        await sendNotification(savedUser.fcmToken, notification)

        if (!savedUser) {
            let error = new Error("an error occured")
            return next(error)
        }

        return res.status(200).json({
            response: 'registered successfully'
        })

    } catch (error) {
        error.message = error.message || "an error occured try later"
        return next(error)
    }
}


module.exports.fetchTrade = async (req, res, next) => {
    try {
        console.log('ssssssssssssssssssss')
        let {
            user
        } = req.body

        let TradeExist = await Trade.find({ user: user })
        if (!TradeExist) {
            let error = new Error("No trade found.")
            return next(error)
        }
        console.log(TradeExist)
        //fetch all transactions and populate store!!!  
        return res.status(200).json({
            response: TradeExist
        })

    } catch (error) {
        error.message = error.message || "an error occured try later"
        return next(error)
    }
}

module.exports.changeCurrency = async (req, res, next) => {
    try {
        const {
            user, name, code
        } = req.body;

        //fetch and check for existence of user
        let foundUser = await User.findOne({ email: user.email })
        if (!foundUser) {
            return res.status(404).json({
                response: 'no user found'
            })
        }
        // update the currency fields of user object on database
        foundUser.currency = code
        let modifiedUser = await foundUser.save()

        if (!modifiedUser) {
            throw new Error('internal server error')
        }
        // send modified user back to the front end
        return res.status(200).json({
            response: modifiedUser
        })

    } catch (error) {
        return next(new Error(error.message || 'An error occurred, try again later.'));
    }
};


module.exports.fetchDeposit = async (req, res, next) => {
    try {
        const { user } = req.body;

        console.log(req.body)
        if (!user?.email) {
            return res.status(400).json({ response: 'User email is required' });
        }

        // Find user by email
        const foundUser = await User.findOne({ email: user.email });
        if (!foundUser) {
            return res.status(404).json({ response: 'No user found' });
        }

        // Fetch deposits by user _id
        const allDeposit = await Deposit.find({ user: foundUser._id }).sort({ date: -1 });

        return res.status(200).json({
            response: allDeposit
        });
    } catch (error) {
        return next(new Error(error.message || 'An error occurred, try again later.'));
    }
};

module.exports.createDeposit = async (req, res, next) => {
    try {
        const { user, amount, plan, mode } = req.body;

        // Validate required fields
        if (!user?.email || !amount || !plan || !mode) {
            return res.status(404).json({ response: 'Missing required fields' });
        }

        // Check if user exists
        const foundUser = await User.findOne({ email: user.email });
        if (!foundUser) {
            return res.status(404).json({ response: 'No user found' });
        }

        // Create deposit
        const newDeposit = new Deposit({
            _id: new mongoose.Types.ObjectId(),
            status: 'pending',
            depositId: `DEP-${Date.now()}`,
            amount: String(amount),
            type: mode,
            date: new Date().toISOString(),
            user: foundUser._id
        });

        await newDeposit.save();

        // Send confirmation email
        await resend.emails.send({
            from: 'Alphagainmetrics@alphagainmetrics.xyz',
            to: foundUser.email,
            subject: 'Deposit Initiated – Alphagainmetrics',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; background-color: #fff; border-radius: 8px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                    <h2 style="color: #222;">Deposit Request Submitted</h2>
                    <p>Hello ${foundUser.firstName || foundUser.email},</p>
                    <p>Your deposit request has been received and is currently pending.</p>
                    <p><strong>Amount:</strong> ${amount}</p>
                    <p><strong>Mode:</strong> ${mode}</p>
                    <p><strong>Plan:</strong> ${plan}</p>
                    <p><strong>Status:</strong> Pending</p>
                    <p>We’ll notify you once you have made the pyment and it's confirmed.</p>
                    <p style="margin-top: 30px;">Thank you for choosing <strong>Alphagainmetrics</strong>.</p>
                </div>
            `
        });

        // Fetch all deposits for the user
        const userDeposits = await Deposit.find({ user: foundUser._id }).sort({ date: -1 });

        return res.status(200).json({
            response: userDeposits
        });

    } catch (error) {
        return next(new Error(error.message || 'An error occurred, try again later.'));
    }
};


module.exports.fetchWithdraw = async (req, res, next) => {
    try {
        const { user } = req.body;

        console.log(req.body)
        if (!user?.email) {
            return res.status(400).json({ response: 'User email is required' });
        }

        // Find user by email
        const foundUser = await User.findOne({ email: user.email });
        if (!foundUser) {
            return res.status(404).json({ response: 'No user found' });
        }

        // Fetch deposits by user _id
        const allWithdraw = await Withdraw.find({ user: foundUser._id }).sort({ date: -1 });

        return res.status(200).json({
            response: allWithdraw
        });
    } catch (error) {
        return next(new Error(error.message || 'An error occurred, try again later.'));
    }
};

module.exports.createWithdraw = async (req, res, next) => {
    try {
        const {
            user,
            amount,
            method,
            name,
            phone,
            bitcoin_address,
            etherium_address,
            zelle_address,
            cashapp_address,
            bank_name,
            account_number,
            account_name,
            swift
        } = req.body;

        // Validate required fields
        if (!user?.email || !amount || !method) {
            return res.status(400).json({ response: 'Missing required fields' });
        }

        // Check if user exists
        const foundUser = await User.findOne({ email: user.email });
        if (!foundUser) {
            return res.status(404).json({ response: 'No user found' });
        }

        // Create withdrawal
        const newWithdraw = new Withdraw({
            _id: new mongoose.Types.ObjectId(),
            status: 'Pending',
            withdrawId: `WTH-${Date.now()}`,
            amount: String(amount),
            method: method.toLowerCase(),
            bitcoin_address,
            etherium_address,
            zelle_address,
            cashapp_address,
            bank_name,
            account_number,
            account_name,
            swift,
            phone,
            name,
            date: new Date().toISOString(),
            user: foundUser._id
        });

        await newWithdraw.save();

        // Send email notification
        await resend.emails.send({
            from: 'Alphagainmetrics@alphagainmetrics.xyz',
            to: foundUser.email,
            subject: 'Withdrawal Request Received – Alphagainmetrics',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; background-color: #fff; border-radius: 8px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                    <h2 style="color: #222;">Withdrawal Request Submitted</h2>
                    <p>Hello ${foundUser.firstName || foundUser.email},</p>
                    <p>Your withdrawal request has been received and is currently pending review.</p>
                    <p><strong>Amount:</strong> ${amount}</p>
                    <p><strong>Method:</strong> ${method}</p>
                    <p><strong>Status:</strong> Pending</p>
                    <p>We’ll notify you once your request is processed.</p>
                    <p style="margin-top: 30px;">Thank you for using <strong>Alphagainmetrics</strong>.</p>
                </div>
            `
        });

        // Fetch all withdrawals for the user
        const userWithdrawals = await Withdraw.find({ user: foundUser._id }).sort({ date: -1 });

        return res.status(200).json({
            response: userWithdrawals
        });

    } catch (error) {
        return next(new Error(error.message || 'An error occurred, try again later.'));
    }
};

module.exports.getInvestment = async (req, res, next) => {
    try {
       let investmentId = req.params.id;
       let investment = await Investment.findOne({ user: investmentId });
 
       if (!investment) {
          let error = new Error('an error occured');
          return next(error);
       }
 
       return res.status(200).json({
          response: investment 
       });
    } catch (error) {
        console.log(error)
       error.message = error.message || "an error occured try later";
       return next(error);
    }
 };

 module.exports.fetchUserHandler = async (req, res, next) => {
    try {
       const userId = req.params.id;

       console.log(userId)
 
       const handler = await DepositHandler.find({ user:userId })

 
       return res.status(200).json({
          response: { handler }
       });
    } catch (error) {
        console.log(error)
       return next({
          status: 500,
          message: error.message || "An error occurred while fetching the deposit handler"
       });
    }
 };


 /*
 // the schema
 const DepositHandlerSchema = new mongoose.Schema({
    _id: mongoose.Types.ObjectId,
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    totalDepositsRequired: { type: Number, required: true }, // e.g. 5 deposits
    depositAmount: { type: Number, required: true }, // e.g. 1000 NGN
    depositsMade: { type: Number, default: 0 }, // increments on each deposit

    durationDays: { type: Number, required: true }, // e.g. 30 days
    daysLeft: { type: Number }, // auto-init with durationDays, decremented daily

    startDate: { type: Date, default: Date.now },
    paused: { type: Boolean, default: false },

    lastCountdownUpdate: { type: Date, default: Date.now }, // for daily countdown logic
    status: {
        type: String,
        enum: ['active', 'paused', 'completed', 'expired'],
        default: 'active'
    },
});

DepositHandlerSchema.pre('save', function (next) {
    // Initialize daysLeft on creation
    if (this.isNew && !this.daysLeft) {
        this.daysLeft = this.durationDays;
    }
    next();
});


 */



























