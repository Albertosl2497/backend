const express = require("express");
const router = express.Router();
const { sendEmail } = require("../services/emailService.js");


const Ticket = require("../model/ticketModel");
const User = require("../model/userModel.js");

router.get("/unsold-tickets", async (req, res) => {
  try {
    const latestLottery = await Ticket.findOne({}, { _id: 0 })
      .sort({ lotteryNo: -1 })
      .lean()
      .exec();

    const sortedTickets = latestLottery.availableTickets.sort((a, b) => a - b);

    res.status(200).json({
      lotteryNo: latestLottery.lotteryNo,
      availableTickets: sortedTickets,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

//update the ticket
router.patch("/sell-tickets/:lotteryNo", async (req, res) => {
  const { lotteryNo } = req.params;
  const { ticketNumbers, userInformation } = req.body;

  try {
    let user = await User.findOne({ email: userInformation.email });
    if (!user) {
      // Create a new user if not found
      user = new User(userInformation);
      await user.save();
    } else {
      // Update user information if found
      Object.assign(user, userInformation);
      await user.save();
    }

    const lottery = await Ticket.findOne({ lotteryNo });
    if (!lottery) {
      return res.status(404).json({ message: "Lottery not found" });
    }

    const updatedAvailableTickets = lottery.availableTickets.filter(
      (ticketNumber) => !ticketNumbers.includes(ticketNumber)
    );

    let booked = lottery.bookedTickets.find(
      (booking) =>
        booking?.user?.toString() === user?._id.toString() &&
        booking.lotteryNo == lotteryNo
    );

    if (booked) {
      let tticketNumbers = [...booked.ticketNumbers, ...ticketNumbers];
      const index = lottery.bookedTickets.indexOf(booked);

      await Ticket.updateOne(
        { _id: lottery._id },
        {
          $set: {
            availableTickets: updatedAvailableTickets,
            [`bookedTickets.${index}.ticketNumbers`]: tticketNumbers,
          },
        }
      );
    } else {
      booked = {
        user: user._id,
        ticketNumbers,
        lotteryNo,
      };

      await Ticket.updateOne(
        { _id: lottery._id },
        {
          $set: {
            availableTickets: updatedAvailableTickets,
          },
          $push: {
            bookedTickets: {
              user: user._id,
              ticketNumbers,
              lotteryNo,
            },
          },
        }
      );
    }

    const emailSubject = `CONFIRMACION DE APARTADO DE BOLETOS POR ${userInformation.fullName}`;
    const numTicketsPurchased = ticketNumbers.length; // Contar la cantidad de boletos comprados
    const ticketPrice = 50; // Precio de cada boleto en pesos

    const totalCost = numTicketsPurchased * ticketPrice; // Calcular el costo total
    const currentDate = new Date();
    const formattedDate = `${currentDate.getDate()}/${currentDate.getMonth() + 1}/${currentDate.getFullYear()}`;
    const formattedTime = `${currentDate.getHours() -7}:${currentDate.getMinutes()}`;

        // Generar números adicionales (parejas) para cada número seleccionado
    const additionalNumbers = ticketNumbers.flatMap(ticket => {
        const original = parseInt(ticket);
        return [original, original + 250, original + 500, original + 750];
    }).map(num => num.toString());
    
    // Unir los números de boletos originales con sus parejas
    const combinedTicketNumbers = ticketNumbers.flatMap((ticket, index) => {
        const original = parseInt(ticket);
        const additional = [original + 250, original + 500, original + 750];
        return [original, ...additional].map((num, i) => `[${num}]`);
    }).join(" ");
    
   const emailBody = `𝐇𝐎𝐋𝐀,
    𝐇𝐀𝐒 𝐑𝐄𝐒𝐄𝐑𝐕𝐀𝐃𝐎 ${numTicketsPurchased} 𝐁𝐎𝐋𝐄𝐓𝐎(𝐒): ${combinedTicketNumbers}.
    𝐏𝐀𝐑𝐀 𝐋𝐀 𝐑𝐈𝐅𝐀 𝐃𝐄: $3000 PESOS.
    ● 𝐃𝐄𝐋 𝐃𝐈𝐀: MARTES 22 DE MARZO 2024.
    ● 𝐄𝐋 𝐓𝐎𝐓𝐀𝐋 𝐀 𝐏𝐀𝐆𝐀𝐑 𝐄𝐒 𝐃𝐄: $${totalCost} PESOS.
    ● 𝐂𝐎𝐍 𝐄𝐋 𝐍𝐎𝐌𝐁𝐑𝐄 𝐃𝐄: ${userInformation.fullName}. 
    ● 𝐒𝐎𝐘 𝐃𝐄: ${userInformation.city} ${userInformation.state}.
    ● 𝐌𝐈 𝐍𝐔𝐌𝐄𝐑𝐎 𝐃𝐄 𝐓𝐄𝐋𝐄𝐅𝐎𝐍𝐎 𝐄𝐒: ${userInformation.phoneNumber}.
    𝗙𝗘𝗖𝗛𝗔 𝗗𝗘 𝗥𝗘𝗚𝗜𝗦𝗧𝗥𝗢 𝗗𝗘𝗟 𝗕𝗢𝗟𝗘𝗧𝗢: ${formattedDate} ${formattedTime} Horas.
      
    𝙂𝙧𝙖𝙘𝙞𝙖𝙨! 𝙎𝙖𝙡𝙪𝙙𝙤𝙨,
    𝙀𝙡 𝙚𝙦𝙪𝙞𝙥𝙤 𝙙𝙚 𝙍𝙞𝙛𝙖𝙨 𝙀𝙛𝙚𝙘𝙩𝙞𝙫𝙤 𝘾𝙖𝙢𝙥𝙤 𝙏𝙧𝙚𝙞𝙣𝙩𝙖`;

    await sendEmail(userInformation.email, emailSubject, emailBody);

    res.status(200).json({
      message: `Successfully sold tickets for lottery ${lotteryNo}`,
      updatedAvailableTickets,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

//create tickets in bulk
/*
router.post("/create-lottery", async (req, res) => {
  const { totalTickets } = req.body;
  const count = parseInt(totalTickets, 10);

  try {
    // Get the latest lottery number
    const latestLottery = await Ticket.findOne({}, { _id: 0, lotteryNo: 1 })
      .sort({ lotteryNo: -1 })
      .lean()
      .exec();
    const lotteryNo = latestLottery ? latestLottery.lotteryNo + 1 : 1;

    // Generate an array of available ticket numbers
    const availableTickets = Array(count)
      .fill()
      .map((_, index) => String(index + 1).padStart(String(count).length, "0"));

    // Create the new lottery object
    const newLottery = new Ticket({
      lotteryNo,
      availableTickets,
      soldTickets: [],
      bookedTickets: [],
    });

    // Save the new lottery object to the database
    await newLottery.save();

    res.status(201).json({
      message: `Successfully created lottery ${lotteryNo}`,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
*/

router.post("/create-lottery", async (req, res) => {
  const { totalTickets } = req.body;
  const count = parseInt(totalTickets, 10);
  const padLength = String(count - 1).length; // Calculate the padding length based on the highest ticket number

  try {
    // Get the latest lottery number
    const latestLottery = await Ticket.findOne({}, { _id: 0, lotteryNo: 1 })
      .sort({ lotteryNo: -1 })
      .lean()
      .exec();
    const lotteryNo = latestLottery ? latestLottery.lotteryNo + 1 : 1;

    // Generate an array of available ticket numbers
    const availableTickets = Array(count)
      .fill()
      .map((_, index) => String(index).padStart(padLength, "0")); // Pad ticket numbers with zeroes to the left

    // Create the new lottery object
    const newLottery = new Ticket({
      lotteryNo,
      availableTickets,
      soldTickets: [],
      bookedTickets: [],
    });

    // Save the new lottery object to the database
    await newLottery.save();

    res.status(201).json({
      message: `Successfully created lottery ${lotteryNo}`,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/tickets", async (req, res) => {
  try {
    const tickets = await Ticket.findOne({}, { _id: 0 })
      .sort({ lotteryNo: -1 })
      .populate({
        path: "bookedTickets.user",
        model: "User",
        select: "fullName email",
      })
      .populate({
        path: "soldTickets.user",
        model: "User",
        select: "fullName email",
      });

    if (!tickets) {
      return res.status(404).json({ message: "No tickets found" });
    }

    const availableTickets = tickets.availableTickets.map((ticketNumber) => {
      return {
        lotteryNo: tickets.lotteryNo,
        ticketNumber,
        availability: true,
        sold: false,
      };
    });

    const bookedTickets = tickets.bookedTickets.flatMap((booking) => {
      return booking.ticketNumbers.map((ticketNumber) => {
        return {
          lotteryNo: booking.lotteryNo,
          ticketNumber,
          user: booking.user
            ? `${booking.user.fullName} (${booking.user.email})`
            : null,
          availability: false,
          sold: false,
        };
      });
    });
    const soldTickets = tickets.soldTickets.flatMap((sold) => {
      return sold.ticketNumbers.map((ticketNumber) => {
        console.log("sold.user", sold);
        return {
          lotteryNo: sold.lotteryNo,
          ticketNumber,
          user: sold.user ? `${sold.user.fullName} (${sold.user.email})` : null,
          availability: false,
          sold: true,
        };
      });
    });

    const bookedCount = bookedTickets.length;
    const soldCount = soldTickets.length;

    res.status(200).json({
      tickets: [...bookedTickets, ...availableTickets, ...soldTickets],
      bookedCount,
      soldCount,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/claim-ticket/:lotteryNo/:ticketNo/:value", async (req, res) => {
  const { lotteryNo, ticketNo, value } = req.params;

  try {
    const ticket = await Ticket.findOne({
      lotteryNo,
    });

    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    //available to unavailable
    if (value === "true") {
      let booked = ticket.bookedTickets.find(
        (booking) => booking.user === null && booking.lotteryNo == lotteryNo
      );

      if (booked) {
        const index = ticket.bookedTickets.indexOf(booked);

        await Ticket.updateOne(
          { _id: ticket._id },
          {
            $set: {
              [`bookedTickets.${index}.ticketNumbers`]: [
                ...booked.ticketNumbers,
                ticketNo,
              ],
            },
            $pull: {
              availableTickets: ticketNo.toString(),
            },
          }
        );
      } else {
        const res = await Ticket.updateOne(
          { _id: ticket._id },
          {
            $push: {
              bookedTickets: {
                user: null,
                ticketNumbers: [ticketNo],
                lotteryNo,
              },
            },
            $pull: {
              availableTickets: ticketNo.toString(),
            },
          },
          {
            new: true,
          }
        );
      }

      res.status(200).json({ message: `Ticket ${ticketNo} claimed` });
    } else {
      //unavailable to available

      //find the index of ticket
      const ticketIndex = ticket.bookedTickets.findIndex((booking) =>
        booking.ticketNumbers.includes(ticketNo)
      );

      if (ticketIndex === -1) {
        return res
          .status(404)
          .json({ message: "Sold Tickets can not be made available" });
      }

      let booked = ticket.bookedTickets[ticketIndex];
      const ticketNumbers = booked.ticketNumbers.filter(
        (tn) => tn !== ticketNo
      );

      if (ticketNumbers.length === 0) {
        ticket.bookedTickets.splice(ticketIndex, 1);
      } else {
        booked.ticketNumbers = ticketNumbers;
      }

      await Ticket.updateOne(
        { _id: ticket._id },
        {
          $set: {
            availableTickets: [...ticket.availableTickets, ticketNo],
            bookedTickets: ticket.bookedTickets,
          },
        }
      );

      res.status(200).json({
        message: `Successfully returned ticket ${ticketNo} for lottery ${lotteryNo}`,
        bookedTicket: booked,
      });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/sold-ticket/:lotteryNo/:ticketNo/:value", async (req, res) => {
  const { lotteryNo, ticketNo, value } = req.params;

  try {
    const ticket = await Ticket.findOne({
      lotteryNo,
    });

    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    //unsold to sold
    if (value === "true") {
      let user = null;

      user =
        ticket.bookedTickets.find((booking) =>
          booking.ticketNumbers.includes(ticketNo)
        ) || null;

      let sold = ticket.soldTickets.find((booking) => {
        booking?.user === user && booking.lotteryNo == lotteryNo;
      });

      const ticketIndex = ticket.bookedTickets.findIndex((booking) =>
        booking.ticketNumbers.includes(ticketNo)
      );

      if (ticketIndex !== -1) {
        let newBooked = ticket.bookedTickets[ticketIndex];
        const ticketNumbers = newBooked.ticketNumbers.filter(
          (tn) => tn !== ticketNo
        );

        if (ticketNumbers.length === 0) {
          ticket.bookedTickets.splice(ticketIndex, 1);
        } else {
          newBooked.ticketNumbers = ticketNumbers;
        }
      }

      if (sold) {
        const index = ticket.soldTickets.indexOf(sold);

        await Ticket.updateOne(
          { _id: ticket._id },
          {
            $set: {
              [`soldTickets.${index}.ticketNumbers`]: [
                ...booked.ticketNumbers,
                ticketNo,
              ],
              bookedTickets: ticket.bookedTickets,
            },
            $pull: {
              availableTickets: ticketNo.toString(),
            },
          }
        );
      } else {
        console.log("User", user.user);
        const res = await Ticket.updateOne(
          { _id: ticket._id },
          {
            $set: {
              bookedTickets: ticket.bookedTickets,
            },
            $push: {
              soldTickets: {
                user: user.user || null,
                ticketNumbers: [ticketNo],
                lotteryNo,
              },
            },
            $pull: {
              availableTickets: ticketNo.toString(),
            },
          },
          {
            new: true,
          }
        );
      }

      res.status(200).json({ message: `Ticket ${ticketNo} claimed` });
    } else {
      //sold to unsold

      const ticketIndex = ticket.soldTickets.findIndex((booking) =>
        booking.ticketNumbers.includes(ticketNo)
      );

      if (ticketIndex === -1) {
        return res.status(404).json({ message: "Ticket not found" });
      }

      let booked = ticket.soldTickets[ticketIndex];
      const ticketNumbers = booked.ticketNumbers.filter(
        (tn) => tn !== ticketNo
      );

      if (ticketNumbers.length === 0) {
        ticket.soldTickets.splice(ticketIndex, 1);
      } else {
        booked.ticketNumbers = ticketNumbers;
      }

      await Ticket.updateOne(
        { _id: ticket._id },
        {
          $set: {
            availableTickets: [...ticket.availableTickets, ticketNo],
            soldTickets: ticket.soldTickets,
          },
        }
      );

      res.status(200).json({
        message: `Successfully returned ticket ${ticketNo} for lottery ${lotteryNo}`,
        bookedTicket: booked,
      });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
