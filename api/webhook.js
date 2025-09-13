import Stripe from "stripe";
import nodemailer from "nodemailer";
import { buffer } from "micro";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

export const config = {
  api: {
    bodyParser: false, // required for Stripe webhooks
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const sig = req.headers["stripe-signature"];
  let event;

  try {
    // Use raw buffer for signature verification
    const buf = await buffer(req);

    event = stripe.webhooks.constructEvent(
      buf.toString(),
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const customerEmail = session.customer_details.email;

    // Retrieve line items
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id);

    // Map Price IDs → public URLs of PDFs
    const productFiles = {
      "prod_T32b3o2rnKw8ze": "https://stripe-webhook-delta-pied.vercel.app/files/product1.pdf",
      "price_67890": "https://stripe-webhook-delta-pied.vercel.app/files/product2.pdf",
      "price_ABCDE": "https://stripe-webhook-delta-pied.vercel.app/files/product3.pdf",
    };

    // Build attachments array
    const attachments = lineItems.data
      .map((item) => {
        const pdfUrl = productFiles[item.price.id];
        if (pdfUrl) {
          return {
            filename: `${item.description}.pdf`,
            path: pdfUrl, // Nodemailer will fetch from URL
          };
        }
        return null;
      })
      .filter(Boolean);

    if (attachments.length > 0) {
      // Configure transporter
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS, // App Password if 2FA is enabled
        },
      });

      console.log("📩 Preparing to send email to:", customerEmail, attachments);

      try {
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: customerEmail,
          subject: "Your Digital Products",
          text: "Thanks for your purchase! Your files are attached.",
          attachments,
        });
        console.log(`✅ Sent ${attachments.length} PDF(s) to ${customerEmail}`);
      } catch (err) {
        console.error("❌ Failed to send email:", err);
      }
    } else {
      console.warn("⚠️ No PDF attachments found for this purchase.");
    }
  }

  res.status(200).json({ received: true });
}
