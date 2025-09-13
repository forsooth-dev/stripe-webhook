import Stripe from "stripe";
import nodemailer from "nodemailer";
import { buffer } from "micro"; // ⬅️ NEW

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

export const config = {
  api: {
    bodyParser: false, // ⛔ required for Stripe
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  const sig = req.headers["stripe-signature"];
  let event;

  try {
    // ⬅️ use raw buffer, not req.body
    const buf = await buffer(req);

    event = stripe.webhooks.constructEvent(
      buf.toString(),
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Webhook signature verification failed.", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const customerEmail = session.customer_details.email;

    // Get line items
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id);

    // Map Price IDs → PDFs
    const productFiles = {
      "prod_T32b3o2rnKw8ze": "./files/product1.pdf",
      "price_67890": "./files/product2.pdf",
      "price_ABCDE": "./files/product3.pdf",
    };

    // Collect attachments
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
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });

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
