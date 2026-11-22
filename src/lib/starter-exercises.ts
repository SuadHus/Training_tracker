import type { Equipment, Tracking } from "./workout-doc";

export type StarterExercise = {
  name: string;
  tracking: Tracking;
  equipment: Equipment;
  primaryMuscle: string;
  secondaryMuscles: string[];
};

const lift = (name: string, equipment: Equipment, primaryMuscle: string, secondaryMuscles: string[] = [], tracking: Tracking = "weight_reps"): StarterExercise =>
  ({ name, tracking, equipment, primaryMuscle, secondaryMuscles });

export const starterExercises: readonly StarterExercise[] = [
  lift("Back squat", "barbell", "Quads", ["Glutes", "Hamstrings", "Core"]),
  lift("Front squat", "barbell", "Quads", ["Glutes", "Core"]),
  lift("Bench press", "barbell", "Chest", ["Triceps", "Shoulders"]),
  lift("Incline bench press", "barbell", "Chest", ["Shoulders", "Triceps"]),
  lift("Deadlift", "barbell", "Back", ["Glutes", "Hamstrings", "Forearms"]),
  lift("Romanian deadlift", "barbell", "Hamstrings", ["Glutes", "Back"]),
  lift("Overhead press", "barbell", "Shoulders", ["Triceps", "Core"]),
  lift("Barbell row", "barbell", "Back", ["Biceps", "Forearms"]),
  lift("Hip thrust", "barbell", "Glutes", ["Hamstrings"]),
  lift("Pull-up", "bodyweight", "Back", ["Biceps", "Forearms"], "bodyweight_reps"),
  lift("Chin-up", "bodyweight", "Back", ["Biceps"], "bodyweight_reps"),
  lift("Dip", "bodyweight", "Chest", ["Triceps", "Shoulders"], "bodyweight_reps"),
  lift("Push-up", "bodyweight", "Chest", ["Triceps", "Shoulders"], "bodyweight_reps"),
  lift("Back extension", "bodyweight", "Back", ["Glutes", "Hamstrings"], "bodyweight_reps"),
  lift("Hanging leg raise", "bodyweight", "Core", ["Forearms"], "bodyweight_reps"),
  lift("Leg press", "machine", "Quads", ["Glutes", "Hamstrings"]),
  lift("Leg extension", "machine", "Quads"),
  lift("Leg curl", "machine", "Hamstrings"),
  lift("Calf raise", "machine", "Calves"),
  lift("Chest press machine", "machine", "Chest", ["Triceps", "Shoulders"]),
  lift("Lat pulldown", "cable", "Back", ["Biceps"]),
  lift("Seated cable row", "cable", "Back", ["Biceps"]),
  lift("Cable fly", "cable", "Chest", ["Shoulders"]),
  lift("Triceps pushdown", "cable", "Triceps"),
  lift("Face pull", "cable", "Shoulders", ["Back"]),
  lift("Dumbbell bench press", "dumbbell", "Chest", ["Triceps", "Shoulders"]),
  lift("Dumbbell shoulder press", "dumbbell", "Shoulders", ["Triceps"]),
  lift("Dumbbell row", "dumbbell", "Back", ["Biceps"]),
  lift("Dumbbell curl", "dumbbell", "Biceps", ["Forearms"]),
  lift("Lateral raise", "dumbbell", "Shoulders"),
  lift("Bulgarian split squat", "dumbbell", "Quads", ["Glutes"]),
  lift("Plank", "bodyweight", "Core", [], "duration"),
  lift("Running", "other", "Full body", ["Quads", "Calves"], "distance_duration"),
  lift("Rowing", "machine", "Full body", ["Back", "Quads"], "distance_duration"),
];
