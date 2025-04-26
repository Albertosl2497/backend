async function sendEmail(to, subject, text) {
  try {
    const transporter = nodemailer.createTransport({
      service: "Gmail",
      auth: {
        user: "sorteosmg1@gmail.com",
        pass: "trfxsjbcdkoetypy",
      },
    });

    const mailOptions = {
      from: "sorteosmg1@gmail.com",
      to,
      cc: "sorteosmg1@gmail.com",
      subject,
      text,
    };

    await transporter.sendMail(mailOptions);

    console.log(`Email sent to ${to}`);
  } catch (error) {
    //  Mostrá el error completo
    console.error("ERROR AL ENVIAR:", error); 
  }
}
