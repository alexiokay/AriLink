const {
  AriTranscriber,
  AriTranscriberOptions,
} = require("./AriTranscriberServer");

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

console.log("Hello, world!");

//? ---------------- Convert JSON file to hash map ----------------
function convertJSONFileToHashMap(filePath: any) {
  try {
    // Read the JSON file content
    const fileContent = fs.readFileSync(filePath, "utf8");

    // Parse the JSON content into a JavaScript object
    const jsonObject = JSON.parse(fileContent);

    // Create a new hash map
    const hashMap: any = {};

    // Iterate over the properties of the parsed object
    for (const key in jsonObject) {
      if (jsonObject.hasOwnProperty(key)) {
        // Assign each property as a key-value pair in the hash map
        hashMap[key] = jsonObject[key];
      }
    }

    return hashMap;
  } catch (error) {
    console.error("Error converting JSON file to hash map:", error);
    return null;
  }
}

const jsonFilePath = "./tools/contacts.json";
const contacts = convertJSONFileToHashMap(jsonFilePath);
console.log("Contacts:", contacts);

const { AriControllerServer } = require("./AriControllerServer");

// Specify the options for the transcriber
const options = {
  sslCert: "", //path/to/ssl/certificate.crt
  sslKey: "path/to/ssl/private/key.key",
  wssPort: process.env.WSS_PORT,
  format: "slin16",
  speechLang: "en-US",
  speechModel: "default",
  speakerDiarization: false,
  listenServer: process.env.LISTENER_SERVER,
  audioOutput: "audio.raw",
};

// Create an instance of AriTranscriber with the provided options
const transcriber = new AriTranscriber(options);

// Create an instance of AriControllerServer
const pbxIP = process.env.PBX_IP;
const accessKey = process.env.ASTERISK_LOGIN || "";
const secretKey = process.env.ASTERISK_PASSWORD || "";
const controller = new AriControllerServer(pbxIP, accessKey, secretKey);

// TODO: make it work

controller.on("close", () => {
  console.log("controller closed");
  //transcriber.stop();
});

transcriber.on("close", () => {
  console.log("transcriber closed");

  //controller.stop();
});

// Handle SIGINT signal to gracefully stop the servers
process.on("SIGINT", async () => {
  await controller.close();
  process.exit();
});

// Start the AriControllerServer
controller.start(contacts);

//TODO: add methods to start and stop the transcriber and controller in case if one of them fails or is closed
