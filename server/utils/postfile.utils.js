import axios from "axios";
import FormData from "form-data";

export async function uploadToPostFile(file) {
  const form = new FormData();

  form.append("file", file.buffer, {
    filename: file.originalname,
    contentType: file.mimetype,
  });

  const response = await axios.post(
    "https://postfile.net/v1/upload",
    form,
    {
      headers: {
        ...form.getHeaders(),
        "X-API-Key": process.env.POSTFILE_API_KEY,
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    }
  );

  return response.data;
}