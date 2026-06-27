const TracerFormConfig = require('../models/TracerFormConfig');

// The canonical default config — mirrors the hardcoded TracerStudyForm.jsx exactly.
// Question IDs that match TracerStudyResponse field names are stored as fixed fields;
// any question with a different ID gets stored in extra_answers.
const DEFAULT_CONFIG = {
  version: 1,
  pages: [
    {
      id: 'page_1',
      title: 'Electronic Informed Consent',
      questions: [
        {
          id: 'q_intro',
          type: 'static_text',
          content:
            'Dear Participant,\n\n' +
            'We, the College of Computer Studies, are conducting a Graduate Tracer Study to track the career progress and professional development of our graduates. This study aims to gather valuable feedback on how our educational programs have impacted your career path and job satisfaction. Your participation will help us enhance our curriculum and better support future students. The study involves completing a brief online survey, which will take about 10–15 minutes. Your responses will be kept confidential and used only for research purposes.\n\n' +
            'Thank you for your contribution!\n\n' +
            'Electronic Informed Consent: The purpose of this study is to trace the career trajectories and professional development of our graduates. Participation is completely voluntary. All information collected will be kept confidential and your responses will be anonymized and aggregated.',
          order: 0,
        },
        {
          id: 'consent',
          type: 'radio',
          label:
            'By clicking "Agree" below, you acknowledge that you have read and understand the information provided above, and you voluntarily agree to participate in this study.',
          options: ['Agree', 'Disagree'],
          required: true,
          validValues: ['Agree'],
          order: 1,
        },
      ],
    },
    {
      id: 'page_2',
      title: 'Demographic Profile',
      questions: [
        {
          id: 'contactNumber',
          type: 'text',
          label: 'Contact Number',
          placeholder: 'e.g. 09xxxxxxxxx',
          required: false,
          order: 0,
        },
        {
          id: 'gender',
          type: 'radio',
          label: 'Gender',
          options: ['Male', 'Female', 'Other'],
          required: true,
          order: 1,
        },
      ],
    },
    {
      id: 'page_3',
      title: 'A. General Background',
      questions: [
        {
          id: 'programsCompleted',
          type: 'checkbox',
          label: 'What is/are the program/s you completed at TSU-CCS?',
          options: [
            'Bachelor of Science in Information Systems - Specialized in Business Analytics',
            'Bachelor of Science in Information Technology - Specialized in Network Administration',
            'Bachelor of Science in Information Technology - Specialized in Web and Mobile Application',
            'Bachelor of Science in Information Technology - Specialized in Technical Service Management',
            'Bachelor of Science in Computer Science',
            'Bachelor of Science in Information Technology',
            'Bachelor of Science in Information Systems',
            'Bachelor of Science in Information Management',
            'Master in Information Technology',
            'Master of Science in Information Technology',
          ],
          required: true,
          order: 0,
        },
        {
          id: 'professionalExam',
          type: 'select',
          label: 'Have you taken any professional examination? (e.g. PRC Board Exam, Civil Service)',
          options: [
            'Yes, I passed the examination',
            'Yes, I failed the examination',
            'No, I have not yet taken any examination',
          ],
          required: true,
          order: 1,
        },
        {
          id: 'professionalExamName',
          type: 'text',
          label: 'What professional examination did you take? Please do not abbreviate.',
          placeholder: 'Enter your answer',
          required: true,
          showIf: {
            questionId: 'professionalExam',
            values: ['Yes, I passed the examination', 'Yes, I failed the examination'],
          },
          order: 2,
        },
      ],
    },
    {
      id: 'page_4',
      title: 'B. Employment Data',
      questions: [
        {
          id: 'employmentStatus',
          type: 'select',
          label: 'Are you presently employed?',
          options: ['Yes', 'No', 'Never Employed'],
          required: true,
          order: 0,
        },
        {
          id: 'companyName',
          type: 'text',
          label: 'Company Name',
          placeholder: 'Enter the name of your employer or company',
          required: true,
          showIf: { questionId: 'employmentStatus', values: ['Yes'] },
          order: 1,
        },
        {
          id: 'placeOfWork',
          type: 'radio',
          label: 'Where is your current place of work?',
          options: [
            'Local (within your home country)',
            'Abroad (outside your home country)',
          ],
          required: true,
          showIf: { questionId: 'employmentStatus', values: ['Yes'] },
          order: 2,
        },
        {
          id: 'occupationTitle',
          type: 'text',
          label:
            'What is the title/name of your present occupation? (e.g. Front-End Developer, Software Engineer)',
          placeholder: 'Enter your answer',
          required: true,
          showIf: { questionId: 'employmentStatus', values: ['Yes'] },
          order: 3,
        },
        {
          id: 'industryField',
          type: 'radio',
          label:
            'What is the primary field or industry of the company where you are currently employed?',
          options: [
            'Information Technology',
            'Education',
            'Virtual Assistance and Remote Services',
            'Customer Service and Support',
            'Engineering and Construction',
            'Marketing',
            'Healthcare',
            'Manufacturing',
            'Finance and Banking',
            'Human Resources',
            'Government and Public Administration',
            'Non-Profit/NGO',
            'Other',
          ],
          required: true,
          showIf: { questionId: 'employmentStatus', values: ['Yes'] },
          order: 4,
        },
        {
          id: 'presentEmploymentType',
          type: 'select',
          label: 'What is your present employment type?',
          options: [
            'Regular/Permanent',
            'Casual/Contractual',
            'Part-time',
            'Project-based',
            'Self-employed',
          ],
          required: true,
          showIf: { questionId: 'employmentStatus', values: ['Yes'] },
          order: 5,
        },
        {
          id: 'jobRelatedToDegree',
          type: 'radio',
          label: 'Is your current job related to the field of study of your degree?',
          options: [
            'Yes, it is directly related',
            'Yes, it is somewhat related',
            'No, it is not related',
          ],
          required: true,
          showIf: { questionId: 'employmentStatus', values: ['Yes'] },
          order: 6,
        },
        {
          id: 'yearsInCurrentJob',
          type: 'select',
          label: 'How long have you been in your current job?',
          options: [
            'Less than 6 months',
            '6 months to 1 year',
            '1 to 2 years',
            '2 to 3 years',
            '3 to 5 years',
            'More than 5 years',
          ],
          required: true,
          showIf: { questionId: 'employmentStatus', values: ['Yes'] },
          order: 7,
        },
        {
          id: 'reasonsNotEmployed',
          type: 'checkbox',
          label:
            'If not currently employed or never been employed, please indicate the reason (you may select more than one):',
          options: [
            'Pursuing further studies',
            'Skills do not match current job market demands',
            'Lack of work experience',
            'Geographical constraints',
            'Personal reasons (e.g., health issues, family obligations, gap year)',
            'Exploring different career paths',
            'Waiting for the right job opportunity',
            'Ineffective job search strategies or lack of networking',
            'Market Saturation (increased competition)',
            'Other',
          ],
          required: true,
          showIf: { questionId: 'employmentStatus', values: ['No', 'Never Employed'] },
          order: 8,
        },
      ],
    },
    {
      id: 'page_5',
      title: 'C. Personal Growth',
      questions: [
        {
          id: 'furtherEducation',
          type: 'radio',
          label: 'Have you pursued any further education after graduating?',
          options: ['Yes', 'No'],
          required: true,
          order: 0,
        },
        {
          id: 'furtherEducationType',
          type: 'text',
          label: 'If yes, please specify the type of education you have pursued.',
          placeholder: 'Enter your answer',
          required: true,
          showIf: { questionId: 'furtherEducation', values: ['Yes'] },
          order: 1,
        },
        {
          id: 'pursuedTrainings',
          type: 'radio',
          label: 'Have you pursued any trainings after graduating?',
          options: ['Yes', 'No'],
          required: true,
          order: 2,
        },
        {
          id: 'trainingType',
          type: 'text',
          label: 'If yes, please specify the type of training you pursued.',
          placeholder: 'Enter your answer',
          required: true,
          showIf: { questionId: 'pursuedTrainings', values: ['Yes'] },
          order: 3,
        },
        {
          id: 'personalGrowthRatings',
          type: 'rating_table',
          label: 'Please rate your personal growth in the following areas since graduation.',
          required: true,
          rows: [
            { key: 'technicalSkills',        label: 'Technical Skills' },
            { key: 'problemSolvingSkills',   label: 'Problem-Solving Skills' },
            { key: 'communicationSkills',    label: 'Communication Skills' },
            { key: 'projectManagement',      label: 'Project Management' },
            { key: 'teamworkCollaboration',  label: 'Teamwork and Collaboration' },
            { key: 'adaptability',           label: 'Adaptability' },
            { key: 'workLifeBalance',        label: 'Work-Life Balance' },
            { key: 'criticalThinkingSkills', label: 'Critical Thinking Skills' },
          ],
          ratingOptions: ['Excellent', 'Competent', 'Satisfactory', 'Beginner', 'Non-Acceptable'],
          order: 4,
        },
      ],
    },
    {
      id: 'page_6',
      title: 'D. Professional Growth',
      questions: [
        {
          id: 'promotedInJob',
          type: 'radio',
          label: 'Have you been promoted in your current job?',
          options: ['Yes', 'No'],
          required: true,
          order: 0,
        },
        {
          id: 'significantAccomplishments',
          type: 'radio',
          label: 'Have you achieved any significant accomplishments in your current job?',
          options: [
            'Yes, I have received significant awards or recognitions',
            'No, I have not yet achieved any significant awards or recognitions',
          ],
          required: true,
          order: 1,
        },
        {
          id: 'professionalCertifications',
          type: 'radio',
          label: 'Have you received any professional certifications since graduation?',
          options: ['Yes', 'No'],
          required: true,
          order: 2,
        },
        {
          id: 'professionalDevelopmentActivities',
          type: 'radio',
          label:
            'Have you participated in any professional development activities (e.g., workshops, conferences, seminars)?',
          options: ['Yes', 'No'],
          required: true,
          order: 3,
        },
      ],
    },
  ],
};

// Blank form returned for colleges with no saved config yet
const BLANK_CONFIG = { version: 1, pages: [] };

// Resolve which college's config to load:
//   - Admin: uses ?college= query param
//   - Alumni: uses their own college from req.user.college
function resolveCollege(req) {
  if (req.user?.role === 'alumni') return req.user.college || 'CCS';
  return (req.query.college || '').trim().toUpperCase() || 'CCS';
}

// GET /api/admin/tracer-form-config?college=CCS
// GET /api/alumni/tracer-form-config   (college auto-detected from token)
const getTracerFormConfig = async (req, res) => {
  try {
    const college = resolveCollege(req);
    let cfg = await TracerFormConfig.findOne({ college });

    if (!cfg && college === 'CCS') {
      // Migrate legacy document (saved before per-college was implemented, college field = '')
      const legacy = await TracerFormConfig.findOne({ college: '' });
      if (legacy) {
        legacy.college = 'CCS';
        await legacy.save();
        cfg = legacy;
      } else {
        cfg = await TracerFormConfig.create({ college: 'CCS', config: DEFAULT_CONFIG });
      }
    }

    res.json({ config: cfg ? cfg.config : BLANK_CONFIG, college });
  } catch (err) {
    console.error('getTracerFormConfig error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// PUT /api/admin/tracer-form-config?college=CCS
const updateTracerFormConfig = async (req, res) => {
  try {
    const { config } = req.body;
    if (!config || !Array.isArray(config.pages)) {
      return res.status(400).json({ message: 'Invalid config: pages array is required.' });
    }
    const college = resolveCollege(req);

    let cfg = await TracerFormConfig.findOne({ college });
    if (cfg) {
      cfg.config    = config;
      cfg.updatedBy = req.user.id;
      cfg.markModified('config');
      await cfg.save();
    } else {
      cfg = await TracerFormConfig.create({ college, config, updatedBy: req.user.id });
    }
    res.json({ config: cfg.config, college, message: `Tracer form for ${college} saved.` });
  } catch (err) {
    console.error('updateTracerFormConfig error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = { getTracerFormConfig, updateTracerFormConfig };
