# Variables used by the Discord Voice Logger Terraform configuration

variable "bucket_name" {
  description = "The name of the S3 bucket to create."
  type        = string
  default     = "debate-bro-recordings-802539608101-dev"
}

variable "aws_region" {
  description = "The AWS region in which to create resources."
  type        = string
  default     = "us-east-2"
}

variable "environment" {
  description = "Environment name tag (e.g., dev, prod)."
  type        = string
  default     = "dev"
}

variable "app_name" {
  description = "Base name for ECS/ECR/Logs/SG"
  type        = string
  default     = "discord-debate-bro"
}

variable "transcribe_function_name" {
  type    = string
  default = "debate-bro-transcribe"
}