import XLSX from "xlsx";
import { MongoClient } from "mongodb";

(async () => {
  const uri = "mongodb+srv://gaurangcelora:OvsvtBIU5Xbtw4W7@cluster0.776rihs.mongodb.net/celoradb?retryWrites=true&w=majority&appName=Cluster0"; // change if needed
  const client = new MongoClient(uri);
  await client.connect();

  const db = client.db("celoradb");
  const collection = db.collection("diamondrates");

  // Load Excel (your exact uploaded file)
  const workbook = XLSX.readFile("./diamond_rates_white_stone_1767515227718.xlsx");
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);

  const bulkOps = [];

  rows.forEach(r => {
    if (!r.shape || !r.size) return;

    // NATURAL
    if (r["white diamond (K)"]) {
      bulkOps.push({
        updateMany: {
          filter: {
            shape: r.shape,
            size: r.size,
            diamondType: "Natural",
            colorName: "White Diamond (K)",
            isDeleted: false
          },
          update: { $set: { Price: Number(r["white diamond (K)"]) } }
        }
      });
    }

    // LAB
    if (r["Lab white diamond (CV)"]) {
      bulkOps.push({
        updateMany: {
          filter: {
            shape: r.shape,
            size: r.size,
            diamondType: "Labgrown",
            colorName: "Lab White Diamond (CV)",
            isDeleted: false
          },
          update: { $set: { Price: Number(r["Lab white diamond (CV)"]) } }
        }
      });
    }
  });

  console.log(`Executing ${bulkOps.length} updates...`);
  await collection.bulkWrite(bulkOps);
  console.log("DONE");

  await client.close();
})();