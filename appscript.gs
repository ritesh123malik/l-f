
const SPREADSHEET_ID = "1dz3omCfayBlEX5AIqJh10uyEDcOtIBei56aI8vTtdMg"; // Your provided ID
const SHEET_NAME = "Items";
const USERS_SHEET_NAME = "Users";


const ADMIN_EMAILS = [
  "malikritesh316@gmail.com",
  "riteshmalik21092005@gmail.com", 
  "25ucc171@lnmiit.ac.in", 
  "25ucs138@lnmiit.ac.in",
  "25ucc121@lnmiit.ac.in"
];


const DISCORD_WEBHOOK_URL = ""; 


function doGet(e) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(SHEET_NAME);
    
   
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow(["ID", "Type", "Item", "Desc", "Status", "Reporter", "Email", "Date", "Image", "Lat", "Lng"]);
      return response({ status: "success", data: [] });
    }

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return response({ status: "success", data: [] });
    

    const headers = data.shift(); 
    const json = data.map((row, index) => ({
      rowIndex: index + 2, 
      id: row[0],
      type: row[1],
      item: row[2],
      desc: row[3],
      status: row[4],
      reporter: row[5],
      email: row[6],
      date: row[7],
      image: row[8],
      lat: row[9],
      lng: row[10]
    })).reverse(); 

    return response({ status: "success", data: json });
  } catch (error) {
    return response({ status: "error", message: error.toString() });
  }
}

// --- 2. ACTIONS (POST) ---
function doPost(e) {
  const lock = LockService.getScriptLock();
  
  try {
  
    lock.waitLock(10000); 
    
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const params = JSON.parse(e.postData.contents);
    const action = params.action;

    
    if (action === "REPORT") {
      let sheet = ss.getSheetByName(SHEET_NAME);
      if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
      
      
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        const lastData = sheet.getRange(lastRow, 7, 1, 2).getValues()[0];
        const lastEmail = lastData[0];
        const lastTime = new Date(lastData[1]).getTime();
        const currentTime = new Date().getTime();
        
        if (lastEmail === params.email && (currentTime - lastTime) < 30000) {
          return response({ result: "error", message: "⏳ Slow down! Please wait 30s." });
        }
      }

      
      const id = Utilities.getUuid(); 
      
      sheet.appendRow([
        id, 
        params.type, 
        params.item, 
        params.desc, 
        "Open", 
        params.reporter, 
        params.email, 
        new Date(), 
        params.image || "", 
        params.lat || "", 
        params.lng || ""
      ]);

     
      runSentinelCheck(ss, params);

     
      if (DISCORD_WEBHOOK_URL) {
        sendToDiscord(params);
      }

   
      broadcastNewReportToAll(ss, params); 

      return response({ result: "success", message: "Report Submitted" });
    }

   
    else if (action === "REGISTER_USER") {
      let uSheet = ss.getSheetByName(USERS_SHEET_NAME);
      if (!uSheet) { uSheet = ss.insertSheet(USERS_SHEET_NAME); uSheet.appendRow(["Email", "Joined Date"]); }
      
      const data = uSheet.getDataRange().getValues();
      if (!data.some(r => r[0] === params.email)) {
        uSheet.appendRow([params.email, new Date()]);
      }
      return response({ result: "success" });
    }

    else if (action === "RESOLVE") {
      if (!ADMIN_EMAILS.includes(params.adminEmail)) {
        return response({ result: "error", message: "Unauthorized Action" });
      }
      const sheet = ss.getSheetByName(SHEET_NAME);
      sheet.getRange(params.rowIndex, 5).setValue("Resolved"); 
      return response({ result: "success" });
    }

    
    else if (action === "BROADCAST") {
      if (!ADMIN_EMAILS.includes(params.adminEmail)) {
        return response({ result: "error", message: "Unauthorized: Admins Only" });
      }

      const userSheet = ss.getSheetByName(USERS_SHEET_NAME);
      if (!userSheet) return response({ result: "error", message: "No users database found." });

      const rawData = userSheet.getDataRange().getValues();
      let emails = rawData.slice(1).map(r => r[0]).filter(e => e && e.toString().includes("@"));
      emails = [...new Set(emails)]; 

      if (emails.length === 0) return response({ result: "error", message: "No registered users." });

      const htmlBody = `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e0e0e0; border-radius: 12px; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #4f46e5; text-align: center;">📢 Campus Announcement</h2>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="font-size: 16px; line-height: 1.5; color: #333;">${params.message}</p>
          <div style="margin-top: 30px; text-align: center; font-size: 12px; color: #888;">
            Sent via LNMIIT Lost & Found Portal
          </div>
        </div>
      `;

      const count = sendEmailInBatches(emails, "📢 LNMIIT Portal: " + params.subject, htmlBody);
      return response({ result: "success", message: `Sent to ${count} users.` });
    }

  } catch (e) {
    Logger.log("FATAL ERROR: " + e.toString());
    return response({ result: "error", message: e.toString() });
  } finally {
    lock.releaseLock();
  }
}

/**
 * THE SENTINEL: Matches 'Found' items to 'Lost' items and emails the loser.
 */
function runSentinelCheck(ss, foundParams) {
  try {
    const sheet = ss.getSheetByName(SHEET_NAME);
    const rows = sheet.getDataRange().getValues();
    
    // Look for matches
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      // Logic: Row is "Lost", Status is "Open", and Item Name fuzzy matches
      if (row[1] === "Lost" && row[4] === "Open" && row[2].toString().toLowerCase().includes(foundParams.item.toLowerCase())) {
        
        const loserEmail = row[6];
        
        MailApp.sendEmail({
          to: loserEmail,
          subject: "⚡ MATCH FOUND: Someone found your " + row[2],
          htmlBody: `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #16a34a; border-radius: 12px; background-color: #f0fdf4;">
              <h2 style="color: #16a34a;">Good news!</h2>
              <p>A <b>Found</b> report for <b>"${foundParams.item}"</b> just came in, and it matches your lost item.</p>
              
              <div style="background: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                <p><b>Finder's Description:</b> ${foundParams.desc}</p>
                <p><b>Finder's Email:</b> <a href="mailto:${foundParams.email}" style="color: #2563eb; font-weight: bold;">${foundParams.email}</a></p>
              </div>

              <p style="font-size: 14px; color: #555;">Please contact them immediately via email or check the portal for WhatsApp/Map details.</p>
            </div>
          `
        });
      }
    }
  } catch(e) { Logger.log("Sentinel Error: " + e); }
}


function sendEmailInBatches(recipientList, subject, htmlBody) {
  const CHUNK_SIZE = 40; 
  let sentCount = 0;

  for (let i = 0; i < recipientList.length; i += CHUNK_SIZE) {
    const chunk = recipientList.slice(i, i + CHUNK_SIZE);
    if (chunk.length > 0) {
      try {
        MailApp.sendEmail({
          to: ADMIN_EMAILS[0], // Send TO admin (required field)
          bcc: chunk.join(","), // Blind Copy the users
          subject: subject,
          htmlBody: htmlBody
        });
        sentCount += chunk.length;
        Utilities.sleep(1000); // Sleep 1s to respect API rate limits
      } catch (err) {
        Logger.log("Batch Email Error: " + err);
      }
    }
  }
  return sentCount;
}


function sendToDiscord(p) {
  try {
    const isLost = p.type === 'Lost';
    const color = isLost ? 15548997 : 5763719; // Red / Green
    
    const payload = {
      "username": "Lost & Found Bot",
      "avatar_url": "https://cdn-icons-png.flaticon.com/512/4686/4686036.png",
      "embeds": [{
        "title": `${isLost ? "🔴 LOST" : "🟢 FOUND"}: ${p.item}`,
        "description": p.desc.replace(/\|\|.*$/, ""), // Clean desc
        "color": color,
        "fields": [
          { "name": "Contact", "value": p.email, "inline": true },
          { "name": "Date", "value": new Date().toLocaleDateString(), "inline": true }
        ],
        "thumbnail": { "url": p.image || "" }
      }]
    };
    
    UrlFetchApp.fetch(DISCORD_WEBHOOK_URL, { 
      method: "post", 
      contentType: "application/json", 
      payload: JSON.stringify(payload) 
    });
  } catch(e) { Logger.log("Discord Error: " + e); }
}

function response(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}



function broadcastNewReportToAll(ss, params) {
  try {
    const userSheet = ss.getSheetByName(USERS_SHEET_NAME);
    if (!userSheet) return;

    const emails = userSheet.getDataRange().getValues()
                            .slice(1) 
                            .map(r => r[0])
                            .filter(e => e && e.toString().includes("@"));
    
    const uniqueEmails = [...new Set(emails)];
    if (uniqueEmails.length === 0) return;

    // 2. Setup UI Colors & Text
    const isLost = params.type === 'Lost';
    const headerColor = isLost ? '#ef4444' : '#22c55e'; 
    const badgeText = isLost ? '🔴 LOST ITEM REPORTED' : '🟢 ITEM FOUND';
    
   
    const imageHtml = params.image ? 
      `<div style="text-align: center; margin: 20px 0;">
         <img src="${params.image}" style="max-width: 100%; max-height: 300px; border-radius: 8px; border: 1px solid #ddd; object-fit: cover;">
       </div>` : '';

    
    const htmlBody = `
      <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
         
         <div style="background-color: ${headerColor}; padding: 20px; text-align: center;">
             <h2 style="color: white; margin: 0; font-size: 24px; text-transform: uppercase; letter-spacing: 1px;">${badgeText}</h2>
         </div>
         
         <div style="padding: 30px; background-color: #ffffff;">
             <h1 style="margin-top: 0; text-align: center; color: #1e293b; font-size: 22px;">${params.item}</h1>
             
             ${imageHtml}
             
             <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid ${headerColor};">
               <p style="margin: 8px 0; color: #475569; font-size: 15px;"><strong>📝 Description:</strong><br> ${params.desc.replace(/\|\|.*$/, "")}</p>
               <p style="margin: 8px 0; color: #475569; font-size: 14px;"><strong>📅 Date:</strong> ${new Date().toLocaleDateString()}</p>
             </div>

             <div style="text-align: center; margin-top: 30px;">
                <a href="mailto:${params.email}" style="background-color: ${headerColor}; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px;">📧 Contact Reporter</a>
                <br><br>
                <p style="font-size: 12px; color: #94a3b8;">You are receiving this because you registered on the LNMIIT Portal.</p>
             </div>
         </div>
      </div>
    `;

    
    const subject = `${isLost ? '🔴' : '🟢'} New Report: ${params.item}`;
    sendEmailInBatches(uniqueEmails, subject, htmlBody);

  } catch (e) { Logger.log("Broadcast Error: " + e); }
}



function runSentinelCheck(ss, newParams) {
  try {
    const sheet = ss.getSheetByName(SHEET_NAME);
    const rows = sheet.getDataRange().getValues();
    
   
    const targetType = (newParams.type === "Lost") ? "Found" : "Lost";
    const newItemName = newParams.item.toLowerCase();

   
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const dbType = row[1];       // Column B
      const dbItemName = row[2];   // Column C
      const dbStatus = row[4];     // Column E
      const dbEmail = row[6];      // Column G

     
      if (dbType === targetType && dbStatus === "Open" && 
         (dbItemName.toLowerCase().includes(newItemName) || newItemName.includes(dbItemName.toLowerCase()))) {
        
        // Match Detected! Send email to the user in the database.
        sendMatchEmail(dbEmail, newParams, row);
      }
    }
  } catch(e) { Logger.log("Sentinel Error: " + e); }
}


function sendMatchEmail(recipientEmail, newReport, matchedDbRow) {
  
  const isGoodNews = newReport.type === "Found"; // If new report is Found, it's good news for the Loser
  
  const subject = isGoodNews 
    ? `⚡ GOOD NEWS: Someone found a "${newReport.item}"!` 
    : `👀 UPDATE: Someone lost a "${newReport.item}" similar to what you found`;

  const htmlBody = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 12px; overflow: hidden;">
      <div style="background-color: ${isGoodNews ? '#22c55e' : '#f59e0b'}; padding: 20px; text-align: center;">
        <h2 style="color: white; margin: 0;">${isGoodNews ? 'MATCH FOUND!' : 'POTENTIAL MATCH'}</h2>
      </div>
      
      <div style="padding: 30px; background-color: #fff;">
        <p style="font-size: 16px; color: #333;">
          ${isGoodNews 
            ? `We believe someone just found the <b>${matchedDbRow[2]}</b> you lost.` 
            : `Someone just reported losing a <b>${newReport.item}</b>, which might be the item you found.`}
        </p>

        <div style="background-color: #f8fafc; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #1e293b;">New Report Details:</h3>
          <p><b>Item:</b> ${newReport.item}</p>
          <p><b>Description:</b> ${newReport.desc.replace(/\|\|.*$/, "")}</p>
          ${newReport.image ? `<img src="${newReport.image}" style="max-width:100%; height:auto; border-radius:8px; margin-top:10px;">` : ''}
        </div>

        <div style="text-align: center;">
          <a href="mailto:${newReport.email}" style="background-color: #0f172a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Contact ${newReport.email}</a>
        </div>
        
        <p style="font-size: 12px; color: #999; margin-top: 30px; text-align: center;">
          Check the LNMIIT Portal to resolve this status.
        </p>
      </div>
    </div>
  `;

  MailApp.sendEmail({
    to: recipientEmail,
    subject: subject,
    htmlBody: htmlBody
  });
}

function runSentinelCheck(ss, newParams) {
  try {
    const sheet = ss.getSheetByName(SHEET_NAME);
    const rows = sheet.getDataRange().getValues();
    
 
    const targetType = (newParams.type === "Lost") ? "Found" : "Lost";
    const newItemName = newParams.item.toLowerCase();

   
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const dbType = row[1];       // Column B
      const dbItemName = row[2];   // Column C
      const dbStatus = row[4];     // Column E
      const dbEmail = row[6];      // Column G

      if (dbType === targetType && dbStatus === "Open" && 
         (dbItemName.toLowerCase().includes(newItemName) || newItemName.includes(dbItemName.toLowerCase()))) {
        
       
        sendMatchEmail(dbEmail, newParams, row);
      }
    }
  } catch(e) { Logger.log("Sentinel Error: " + e); }
}

function sendMatchEmail(recipientEmail, newReport, matchedDbRow) {
  
  const isGoodNews = newReport.type === "Found"; // If new report is Found, it's good news for the Loser
  
  const subject = isGoodNews 
    ? `⚡ GOOD NEWS: Someone found a "${newReport.item}"!` 
    : `👀 UPDATE: Someone lost a "${newReport.item}" similar to what you found`;

  const htmlBody = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 12px; overflow: hidden;">
      <div style="background-color: ${isGoodNews ? '#22c55e' : '#f59e0b'}; padding: 20px; text-align: center;">
        <h2 style="color: white; margin: 0;">${isGoodNews ? 'MATCH FOUND!' : 'POTENTIAL MATCH'}</h2>
      </div>
      
      <div style="padding: 30px; background-color: #fff;">
        <p style="font-size: 16px; color: #333;">
          ${isGoodNews 
            ? `We believe someone just found the <b>${matchedDbRow[2]}</b> you lost.` 
            : `Someone just reported losing a <b>${newReport.item}</b>, which might be the item you found.`}
        </p>

        <div style="background-color: #f8fafc; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #1e293b;">New Report Details:</h3>
          <p><b>Item:</b> ${newReport.item}</p>
          <p><b>Description:</b> ${newReport.desc.replace(/\|\|.*$/, "")}</p>
          ${newReport.image ? `<img src="${newReport.image}" style="max-width:100%; height:auto; border-radius:8px; margin-top:10px;">` : ''}
        </div>

        <div style="text-align: center;">
          <a href="mailto:${newReport.email}" style="background-color: #0f172a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Contact ${newReport.email}</a>
        </div>
        
        <p style="font-size: 12px; color: #999; margin-top: 30px; text-align: center;">
          Check the LNMIIT Portal to resolve this status.
        </p>
      </div>
    </div>
  `;

  MailApp.sendEmail({
    to: recipientEmail,
    subject: subject,
    htmlBody: htmlBody
  });
 
}

 function checkMyQuota() {
  var remaining = MailApp.getRemainingDailyQuota();
  Logger.log("🚨 EMAILS LEFT FOR TODAY: " + remaining);
}
