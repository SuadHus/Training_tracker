# Training tracker design

The public site lists every completed workout with exercises, actual sets, and custom measurements. Each workout links to its local training day and shows resting heart rate, the main sleep session ending on that day, Fitbit Sleep Score when supplied, and the first eligible Withings morning weight. Future schedules and templates are editable from a phone.

The owner signs in through Google OpenID Connect. Health providers use distinct OAuth clients and store refresh credentials encrypted on the server. The public read path can expose only four day metrics. Provider-based publishing has a deployment setting for each source so the intended sharing model can be reviewed before activation.

Workout and journal data use PostgreSQL. Reusable workout templates are copied into scheduled sessions. Exercise field definitions extend the set form and public display without changing the database schema. The journal supports drafts, posts, and photos. The installable admin interface uses server authentication on every write.
