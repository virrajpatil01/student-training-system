import { extractStudentDetails, extractContact, buildGlobalFormConfigMap } from "./src/utils/studentDetails.js";

console.log("=================================================");
console.log("RUNNING STUDENT DETAILS & EXTRACTION TEST SUITE");
console.log("=================================================");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passed++;
  } else {
    console.error(`[FAIL] ${message}`);
    failed++;
  }
}

// 1. Test buildGlobalFormConfigMap
const mockRoles = [
  { id: "1", role_name: "Web Development" },
  {
    id: "2",
    role_name: 'SYS_FORM_CFG::6a94336d::[{"id":"name","name":"Full Name","type":"text","required":true,"isDefault":true},{"id":"role","name":"Role","type":"dropdown","required":true,"isDefault":true},{"id":"field_1792127788182_cjfm","name":"Email Address","type":"email","required":true,"isDefault":false},{"id":"field_1792127789736_uv74","name":"Phone Number","type":"tel","required":true,"isDefault":false},{"id":"field_1792127792072_t6qv","name":"College / University","type":"text","required":true,"isDefault":false}]'
  }
];

const mockLinks = [
  {
    id: "link-1",
    token: "e1ad50ee",
    form_config: [
      { id: "name", name: "Full Name", type: "text" },
      { id: "field_age", name: "Age", type: "number" },
      { id: "field_gender", name: "Gender", type: "dropdown" }
    ]
  }
];

const configMap = buildGlobalFormConfigMap(mockRoles, mockLinks);
assert(configMap.has("field_1792127788182_cjfm"), "Config map contains Email Address field ID");
assert(configMap.get("field_1792127788182_cjfm").name === "Email Address", "Email Address label resolved correctly");
assert(configMap.get("field_1792127792072_t6qv").name === "College / University", "College label resolved correctly");
assert(configMap.get("field_age").name === "Age", "Age label resolved correctly");

// 2. Test Existing Student Suraj Ghadage (real database record)
const surajStudent = {
  id: "3022454e-6ca0-42f6-b4d0-6fcc92d10099",
  name: "Suraj Ghadage",
  role_id: "9d523030-bfc7-426f-a6fe-cd61988bd7bb",
  registration_link_id: "dd671984-ae96-4deb-8640-49827b7d0a24",
  extra_fields: {
    field_1792127788182_cjfm: "surajghadage1206@gmail.com",
    field_1792127789736_uv74: "9456160255",
    field_1792127792072_t6qv: "Willengdon college sangli "
  }
};

const surajDetails = extractStudentDetails(surajStudent, configMap);
assert(surajDetails.cleanName === "Suraj Ghadage", "Suraj Ghadage cleanName matches");
assert(surajDetails.email === "surajghadage1206@gmail.com", "Suraj Ghadage email is surajghadage1206@gmail.com (NOT —)");
assert(surajDetails.phone === "9456160255", "Suraj Ghadage phone is 9456160255 (NOT —)");
assert(surajDetails.customDetails.length === 1, "Suraj Ghadage has 1 custom detail");
assert(surajDetails.customDetails[0].label === "College / University", "Suraj Ghadage custom detail is College / University");
assert(surajDetails.customDetails[0].value === "Willengdon college sangli", "Suraj Ghadage college value matches Willengdon college sangli");

// 3. Test Historical Composite Name Student
const compositeStudent = {
  id: "comp-1",
  name: "Aarav Sharma (Phone Number: +91 9876543210 | Email Address: aarav@gmail.com | College / University: COEP Pune | Age: 22 | Village Name: Satara)",
  role_id: "role-1",
  extra_fields: {}
};

const compDetails = extractStudentDetails(compositeStudent, configMap);
assert(compDetails.cleanName === "Aarav Sharma", "Composite student clean name extracted");
assert(compDetails.email === "aarav@gmail.com", "Composite student email extracted");
assert(compDetails.phone === "+91 9876543210", "Composite student phone extracted");
const compCollege = compDetails.customDetails.find(d => d.label === "College / University");
assert(compCollege?.value === "COEP Pune", "Composite student college extracted from parenthetical string");
const compAge = compDetails.customDetails.find(d => d.label === "Age");
assert(compAge?.value === "22", "Composite student age extracted from parenthetical string");
const compVillage = compDetails.customDetails.find(d => d.label === "Village Name");
assert(compVillage?.value === "Satara", "Composite student village extracted from parenthetical string");

// 4. Test Newly Registered Student with Enriched Payload
const newStudent = {
  id: "new-1",
  name: "Pooja Patil",
  role_id: "role-2",
  extra_fields: {
    field_email_1: "pooja@example.com",
    field_phone_1: "9123456780",
    field_college_1: "Shivaji University Kolhapur",
    field_age_1: "21",
    "Email Address": "pooja@example.com",
    "Phone Number": "9123456780",
    "College / University": "Shivaji University Kolhapur",
    Age: "21",
    email: "pooja@example.com",
    phone: "9123456780",
    college: "Shivaji University Kolhapur",
    age: "21"
  }
};

const newDetails = extractStudentDetails(newStudent, configMap);
assert(newDetails.cleanName === "Pooja Patil", "New student clean name matches");
assert(newDetails.email === "pooja@example.com", "New student email matches");
assert(newDetails.phone === "9123456780", "New student phone matches");
const newCollege = newDetails.customDetails.find(d => d.label === "College / University");
assert(newCollege?.value === "Shivaji University Kolhapur", "New student college matches");
const newAge = newDetails.customDetails.find(d => d.label === "Age");
assert(newAge?.value === "21", "New student age matches");

// 5. Test Genuine Missing Values
const emptyStudent = {
  id: "empty-1",
  name: "Solo Student",
  role_id: "role-3",
  extra_fields: {}
};

const emptyDetails = extractStudentDetails(emptyStudent, configMap);
assert(emptyDetails.cleanName === "Solo Student", "Empty student clean name");
assert(emptyDetails.email === "—", "Empty student email is genuinely —");
assert(emptyDetails.phone === "—", "Empty student phone is genuinely —");
assert(emptyDetails.customDetails.length === 0, "Empty student has no fabricated custom details");

// 6. Test Backwards Compatibility with extractContact
const compatContact = extractContact(surajStudent, configMap);
assert(compatContact.email === "surajghadage1206@gmail.com", "extractContact returns correct email");
assert(compatContact.phone === "9456160255", "extractContact returns correct phone");
assert(compatContact.cleanName === "Suraj Ghadage", "extractContact returns correct cleanName");

console.log("=================================================");
console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log("=================================================");

if (failed > 0) {
  process.exit(1);
}
