import Stripe from "stripe";
import nodemailer from "nodemailer";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  const sig = req.headers["stripe-signature"];
  let event;

  try {
    // Stripe requires raw body parsing
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed.", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const customerEmail = session.customer_details.email;

    // Get line items (to know what was purchased)
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id);

    // Map Price IDs → PDFs
    const productFiles = {
      "price_12345": "./files/product1.pdf",
      "price_67890": "./files/product2.pdf",
      "price_ABCDE": "./files/product3.pdf",
    };

    // Collect all attachments for this order
    const attachments = lineItems.data
      .map((item) => {
        const pdfPath = productFiles[item.price.id];
        if (pdfPath) {
          return { filename: `${item.description}.pdf`, path: pdfPath };
        }
        return null;
      })
      .filter(Boolean);

    if (attachments.length > 0) {
      // Email setup
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });

      // Send email with all PDFs
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: customerEmail,
        subject: "Your Digital Products",
        text: "Thanks for your purchase! Your files are attached.",
        attachments,
      });

      console.log(`✅ Sent ${attachments.length} PDF(s) to ${customerEmail}`);
    }
  }

  res.json({ received: true });
}

// Needed for Stripe webhook verification
export const config = {
  api: {
    bodyParser: false,
  },
};
